const crypto = require('crypto');

const TABLES = [
  'sceneshop_accounts', 'sceneshop_organizations', 'sceneshop_tracks', 'sceneshop_products',
  'sceneshop_commercial_assets', 'sceneshop_campaigns', 'sceneshop_external_offers',
  'sceneshop_payment_intents', 'sceneshop_sales', 'sceneshop_commissions', 'sceneshop_audit_log'
];

function sha256(value) { return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex'); }

async function collectRecoveryManifest(store) {
  const backend = store && (typeof store.backendKind === 'function' ? store.backendKind() : store.kind);
  if (!store || backend !== 'postgres' || typeof store.readDomain !== 'function') throw new Error('Recovery manifest exige DATA_BACKEND=postgres.');
  return store.readDomain(async (client) => {
    const state = await client.query(`SELECT revision,payload::text AS payload FROM sceneshop_state_snapshots WHERE singleton_id=1`);
    if (!state.rowCount) throw new Error('Snapshot PostgreSQL ausente.');
    const migration = await client.query(`SELECT version FROM sceneshop_schema_migrations ORDER BY version DESC LIMIT 1`);
    const wal = await client.query(`SELECT pg_current_wal_lsn()::text AS wal_lsn`);
    const counts = {};
    for (const table of TABLES) {
      const q = await client.query(`SELECT count(*)::bigint AS n FROM ${table}`);
      counts[table] = Number(q.rows[0].n || 0);
    }
    return {
      revision: Number(state.rows[0].revision),
      snapshotSha256: sha256(state.rows[0].payload),
      latestMigration: migration.rows[0] ? migration.rows[0].version : null,
      walLsn: wal.rows[0] ? wal.rows[0].wal_lsn : null,
      counts,
      capturedAt: new Date().toISOString(),
    };
  });
}

class PostgresRecoveryRepository {
  constructor({ store } = {}) { if (!store) throw new TypeError('PostgresRecoveryRepository requer store.'); this.store = store; }
  async createCheckpoint({ id = `dr_${crypto.randomUUID()}`, metadata = {} } = {}) {
    const manifest = await collectRecoveryManifest(this.store);
    await this.store.writeDomain((client) => client.query(
      `INSERT INTO sceneshop_recovery_checkpoints(id,status,source_revision,source_snapshot_sha256,source_latest_migration,source_wal_lsn,manifest,metadata)
       VALUES($1,'CREATED',$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
      [id, manifest.revision, manifest.snapshotSha256, manifest.latestMigration, manifest.walLsn, JSON.stringify(manifest), JSON.stringify(metadata || {})]
    ));
    return { id, status: 'CREATED', manifest };
  }
  async get(id) {
    return this.store.readDomain(async (client) => {
      const q = await client.query(`SELECT * FROM sceneshop_recovery_checkpoints WHERE id=$1`, [id]);
      if (!q.rowCount) return null;
      const r = q.rows[0];
      return { id:r.id,status:r.status,manifest:r.manifest||{},metadata:r.metadata||{},createdAt:new Date(r.created_at).getTime(),verifiedAt:r.verified_at?new Date(r.verified_at).getTime():null,verification:r.verification||null };
    });
  }
  async mark(id, status, verification) {
    const allowed = ['VERIFIED','FAILED']; if (!allowed.includes(status)) throw new Error('Status de recovery inválido.');
    return this.store.writeDomain(async (client) => {
      const q = await client.query(`UPDATE sceneshop_recovery_checkpoints SET status=$2,verification=$3::jsonb,verified_at=now() WHERE id=$1 RETURNING id,status,verified_at`, [id,status,JSON.stringify(verification||{})]);
      return q.rowCount ? { id:q.rows[0].id,status:q.rows[0].status,verifiedAt:new Date(q.rows[0].verified_at).getTime() } : null;
    });
  }
  async health() {
    return this.store.readDomain(async (client) => {
      const q = await client.query(`SELECT id,status,created_at,verified_at FROM sceneshop_recovery_checkpoints ORDER BY created_at DESC LIMIT 1`);
      if (!q.rowCount) return { ok:true, backend:'postgres-recovery', latest:null };
      const r=q.rows[0]; return { ok:true, backend:'postgres-recovery', latest:{ id:r.id,status:r.status,createdAt:new Date(r.created_at).getTime(),verifiedAt:r.verified_at?new Date(r.verified_at).getTime():null } };
    });
  }
}

function compareRecoveryManifest(expected, actual) {
  const mismatches = [];
  for (const field of ['revision','snapshotSha256','latestMigration']) if (expected[field] !== actual[field]) mismatches.push({ field, expected: expected[field], actual: actual[field] });
  const keys = new Set([...Object.keys(expected.counts||{}), ...Object.keys(actual.counts||{})]);
  for (const key of [...keys].sort()) if (Number(expected.counts?.[key]||0) !== Number(actual.counts?.[key]||0)) mismatches.push({ field:`counts.${key}`, expected:Number(expected.counts?.[key]||0), actual:Number(actual.counts?.[key]||0) });
  return { ok: mismatches.length === 0, mismatches };
}

module.exports = { TABLES, sha256, collectRecoveryManifest, PostgresRecoveryRepository, compareRecoveryManifest };
