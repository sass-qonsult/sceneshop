const path = require("path");
const { projectState } = require("./postgres-projection");
const { listMigrationManifest, validateMigrationManifest } = require("./migration-manifest");

function requirePg() {
  try {
    return require("pg");
  } catch (err) {
    const e = new Error(
      "DATA_BACKEND=postgres requer o driver 'pg'. Instale a dependência antes de iniciar o backend PostgreSQL."
    );
    e.cause = err;
    throw e;
  }
}

class PostgresStateRepository {
  constructor({ connectionString, migrationsDir, projector = projectState }) {
    this.connectionString = connectionString;
    this.migrationsDir = migrationsDir || path.join(__dirname, "migrations");
    this.pool = null;
    this.kind = "postgres";
    this.revision = null;
    this.projector = projector;
    this.migrationManifest = null;
  }

  async init() {
    if (!this.connectionString) throw new Error("DATABASE_URL é obrigatório para DATA_BACKEND=postgres.");
    const { Pool } = requirePg();
    this.pool = new Pool({ connectionString: this.connectionString });
    await this.pool.query("SELECT 1");
    await this.migrate();
    await this.ensureRelationalProjection();
  }

  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [77614320]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS sceneshop_schema_migrations (
          version TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      const manifest = await listMigrationManifest(this.migrationsDir);
      this.migrationManifest = validateMigrationManifest(manifest);

      for (const migration of manifest) {
        const { version: name, sql, checksum } = migration;
        const found = await client.query(
          "SELECT checksum FROM sceneshop_schema_migrations WHERE version=$1",
          [name]
        );
        if (found.rowCount) {
          if (found.rows[0].checksum !== checksum) {
            throw new Error(`Migration ${name} foi alterada depois de aplicada.`);
          }
          continue;
        }

        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO sceneshop_schema_migrations(version, checksum) VALUES($1,$2)",
            [name, checksum]
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    } finally {
      try { await client.query("SELECT pg_advisory_unlock($1)", [77614320]); } catch (_) {}
      client.release();
    }
  }

  async ensureRelationalProjection() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [77614321]);
      const current = await client.query(
        "SELECT payload FROM sceneshop_state_snapshots WHERE singleton_id=1"
      );
      if (current.rowCount) await this.projector(client, current.rows[0].payload);
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  async load() {
    const result = await this.pool.query(
      "SELECT payload, revision FROM sceneshop_state_snapshots WHERE singleton_id=1"
    );
    if (!result.rowCount) {
      this.revision = null;
      return null;
    }
    this.revision = Number(result.rows[0].revision);
    return result.rows[0].payload;
  }

  async save(snapshot) {
    const version = Number(snapshot && snapshot.version) || 0;
    const payload = JSON.stringify(snapshot);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [77614321]);

      if (this.revision == null) {
        const inserted = await client.query(
          `INSERT INTO sceneshop_state_snapshots(singleton_id, state_version, payload, revision, updated_at)
           VALUES(1, $1, $2::jsonb, 0, now())
           ON CONFLICT(singleton_id) DO NOTHING
           RETURNING revision`,
          [version, payload]
        );
        if (inserted.rowCount) {
          this.revision = Number(inserted.rows[0].revision);
          const counts = await this.projector(client, snapshot);
          await client.query(
            `INSERT INTO sceneshop_outbox(topic,aggregate_type,aggregate_id,payload)
             VALUES('state.projected','state','singleton',$1::jsonb)`,
            [JSON.stringify({ revision: this.revision, counts })]
          );
          await client.query("COMMIT");
          return;
        }
        const current = await client.query(
          "SELECT revision FROM sceneshop_state_snapshots WHERE singleton_id=1"
        );
        if (!current.rowCount) throw new Error("Snapshot PostgreSQL desapareceu durante a gravação.");
        this.revision = Number(current.rows[0].revision);
      }

      const updated = await client.query(
        `UPDATE sceneshop_state_snapshots
         SET state_version=$1, payload=$2::jsonb, revision=revision+1, updated_at=now()
         WHERE singleton_id=1 AND revision=$3
         RETURNING revision`,
        [version, payload, this.revision]
      );
      if (!updated.rowCount) {
        const err = new Error("Conflito de concorrência no snapshot SceneShop: outro processo gravou uma revisão mais nova.");
        err.code = "SCENESHOP_CONCURRENT_WRITE";
        throw err;
      }

      const nextRevision = Number(updated.rows[0].revision);
      const counts = await this.projector(client, snapshot);
      await client.query(
        `INSERT INTO sceneshop_outbox(topic,aggregate_type,aggregate_id,payload)
         VALUES('state.projected','state','singleton',$1::jsonb)`,
        [JSON.stringify({ revision: nextRevision, counts })]
      );
      await client.query("COMMIT");
      this.revision = nextRevision;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }


  /**
   * Commit de domínio PostgreSQL. O chamador fornece apenas as escritas
   * relacionais daquele domínio; o snapshot de compatibilidade e a outbox são
   * atualizados na MESMA transação. Nenhum store.save() diferido participa do
   * caminho crítico.
   */
  async commitDomainSnapshot(snapshot, { topic, aggregateType, aggregateId, outboxPayload, write } = {}) {
    const version = Number(snapshot && snapshot.version) || 0;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [77614321]);
      const current = await client.query(
        "SELECT revision FROM sceneshop_state_snapshots WHERE singleton_id=1 FOR UPDATE"
      );
      if (!current.rowCount) throw new Error("Snapshot PostgreSQL ausente durante commit de domínio.");
      const dbRevision = Number(current.rows[0].revision);
      if (this.revision != null && dbRevision !== this.revision) {
        const err = new Error("Conflito de concorrência no Data Plane: revisão PostgreSQL avançou em outro processo.");
        err.code = "SCENESHOP_CONCURRENT_WRITE";
        throw err;
      }

      const writeResult = write ? await write(client) : null;
      if (writeResult && writeResult.skipSnapshot) {
        await client.query("COMMIT");
        return { revision: this.revision, writeResult };
      }

      const updated = await client.query(
        `UPDATE sceneshop_state_snapshots
         SET state_version=$1, payload=$2::jsonb, revision=revision+1, updated_at=now()
         WHERE singleton_id=1 AND revision=$3
         RETURNING revision`,
        [version, JSON.stringify(snapshot), dbRevision]
      );
      if (!updated.rowCount) {
        const err = new Error("Conflito de concorrência ao consolidar snapshot de domínio.");
        err.code = "SCENESHOP_CONCURRENT_WRITE";
        throw err;
      }
      const nextRevision = Number(updated.rows[0].revision);

      if (topic) {
        await client.query(
          `INSERT INTO sceneshop_outbox(topic,aggregate_type,aggregate_id,payload)
           VALUES($1,$2,$3,$4::jsonb)`,
          [topic, aggregateType || null, aggregateId || null, JSON.stringify(outboxPayload || {})]
        );
      }
      await client.query("COMMIT");
      this.revision = nextRevision;
      return { revision: nextRevision, writeResult };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  async readDomain(work) {
    if (typeof work !== "function") throw new TypeError("readDomain requer uma função.");
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  async writeDomain(work) {
    if (typeof work !== "function") throw new TypeError("writeDomain requer uma função.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  async importSnapshot(snapshot, metadata = {}) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [77614321]);
      const current = await client.query(
        "SELECT revision FROM sceneshop_state_snapshots WHERE singleton_id=1 FOR UPDATE"
      );
      if (current.rowCount && !metadata.replace) {
        throw new Error("Destino PostgreSQL já contém estado SceneShop; importação recusada sem replace explícito.");
      }

      const version = Number(snapshot && snapshot.version) || 0;
      if (current.rowCount) {
        await client.query(
          `UPDATE sceneshop_state_snapshots
           SET state_version=$1, payload=$2::jsonb, revision=revision+1, updated_at=now()
           WHERE singleton_id=1`,
          [version, JSON.stringify(snapshot)]
        );
      } else {
        await client.query(
          `INSERT INTO sceneshop_state_snapshots(singleton_id, state_version, payload, revision, updated_at)
           VALUES(1, $1, $2::jsonb, 0, now())`,
          [version, JSON.stringify(snapshot)]
        );
      }

      // Importação é uma operação administrativa explícita: ao substituir o
      // runtime, identidade também é substituída. O projector normal não toca
      // contas existentes porque PostgreSQL é a autoridade de autenticação.
      await client.query("DELETE FROM sceneshop_auth_sessions");
      await client.query("DELETE FROM sceneshop_accounts");
      await client.query("DELETE FROM sceneshop_authors");
      const projectionCounts = await this.projector(client, snapshot);

      await client.query(
        `INSERT INTO sceneshop_runtime_imports
           (source_checksum, source_bytes, source_version, summary)
         VALUES($1, $2, $3, $4::jsonb)`,
        [
          metadata.sourceChecksum || "0".repeat(64),
          Number(metadata.sourceBytes) || 0,
          Number(metadata.sourceVersion) || version,
          JSON.stringify({ ...(metadata.summary || {}), relationalProjection: projectionCounts }),
        ]
      );
      await client.query("COMMIT");
      this.revision = null;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  async health() {
    try {
      const result = await this.pool.query(
        `SELECT now() AS server_time,
                (SELECT count(*)::int FROM sceneshop_schema_migrations) AS migrations,
                (SELECT version FROM sceneshop_schema_migrations ORDER BY version DESC LIMIT 1) AS latest_migration,
                (SELECT revision FROM sceneshop_state_snapshots WHERE singleton_id=1) AS revision,
                (SELECT count(*)::int FROM sceneshop_accounts) AS accounts,
                (SELECT count(*)::int FROM sceneshop_tracks) AS tracks,
                (SELECT count(*)::int FROM sceneshop_products) AS products,
                (SELECT count(*)::int FROM sceneshop_sales) AS sales,
                (SELECT count(*)::int FROM sceneshop_orders) AS orders,
                (SELECT count(*)::int FROM sceneshop_commissions) AS commissions,
                (SELECT count(*)::int FROM sceneshop_auth_sessions WHERE revoked_at IS NULL AND expires_at > now()) AS active_sessions,
                (SELECT count(*)::int FROM sceneshop_author_kyc WHERE status='em_analise') AS pending_kyc,
                (SELECT count(*)::int FROM sceneshop_playback_bindings WHERE enabled) AS playback_bindings,
                (SELECT count(*)::int FROM sceneshop_playback_sessions) AS playback_sessions,
                (SELECT count(*)::int FROM sceneshop_commerce_providers WHERE enabled) AS commerce_providers`
      );
      const row = result.rows[0];
      const expected = this.migrationManifest || validateMigrationManifest(await listMigrationManifest(this.migrationsDir));
      const migrationOk = Number(row.migrations) === expected.count && row.latest_migration === expected.latest;
      return {
        ok: migrationOk,
        backend: this.kind,
        relational: true,
        ...row,
        expectedMigrations: expected.count,
        expectedLatestMigration: expected.latest,
        migrationOk,
        ...(migrationOk ? {} : { error: `Migration drift: banco=${row.latest_migration || 'none'} (${row.migrations}), esperado=${expected.latest} (${expected.count}).` }),
      };
    } catch (err) {
      return { ok: false, backend: this.kind, error: err.message };
    }
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

module.exports = { PostgresStateRepository };
