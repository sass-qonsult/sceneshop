function ms(v) { return v == null ? null : new Date(v).getTime(); }
function eventRow(r) {
  return {
    id: Number(r.id),
    topic: r.topic,
    aggregateType: r.aggregate_type || null,
    aggregateId: r.aggregate_id || null,
    payload: r.payload || {},
    createdAt: ms(r.created_at),
    publishedAt: ms(r.published_at),
    attempts: Number(r.attempts || 0),
    nextAttemptAt: ms(r.next_attempt_at),
    lockedBy: r.locked_by || null,
    lockedAt: ms(r.locked_at),
    lastError: r.last_error || null,
    deadLetteredAt: ms(r.dead_lettered_at),
  };
}

class PostgresOutboxRepository {
  constructor({ store, workerId }) {
    if (!store) throw new TypeError('PostgresOutboxRepository requer store.');
    this.store = store;
    this.workerId = String(workerId || '').slice(0, 180);
    if (!this.workerId) throw new TypeError('workerId é obrigatório.');
  }

  async claimBatch({ limit = 20, leaseMs = 30000 } = {}) {
    const batch = Math.max(1, Math.min(200, Number(limit) || 20));
    const lease = Math.max(1000, Math.min(15 * 60 * 1000, Number(leaseMs) || 30000));
    return this.store.writeDomain(async (client) => {
      const q = await client.query(
        `WITH picked AS (
           SELECT id
           FROM sceneshop_outbox
           WHERE published_at IS NULL
             AND dead_lettered_at IS NULL
             AND next_attempt_at <= now()
             AND (locked_at IS NULL OR locked_at < now() - ($2::bigint * interval '1 millisecond'))
           ORDER BY created_at ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE sceneshop_outbox o
         SET locked_by=$3, locked_at=now(), attempts=o.attempts+1
         FROM picked
         WHERE o.id=picked.id
         RETURNING o.*`,
        [batch, lease, this.workerId]
      );
      return q.rows.map(eventRow);
    });
  }

  async ack(id) {
    const eventId = Number(id);
    return this.store.writeDomain(async (client) => {
      const q = await client.query(
        `UPDATE sceneshop_outbox
         SET published_at=now(), locked_by=NULL, locked_at=NULL, last_error=NULL
         WHERE id=$1 AND published_at IS NULL AND dead_lettered_at IS NULL AND locked_by=$2
         RETURNING *`,
        [eventId, this.workerId]
      );
      return q.rowCount ? eventRow(q.rows[0]) : null;
    });
  }

  async fail(id, error, { delayMs = 1000, maxAttempts = 8 } = {}) {
    const eventId = Number(id);
    const delay = Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(delayMs) || 0));
    const max = Math.max(1, Math.min(100, Number(maxAttempts) || 8));
    const message = String(error && (error.stack || error.message) || error || 'unknown_error').slice(0, 4000);
    return this.store.writeDomain(async (client) => {
      const q = await client.query(
        `UPDATE sceneshop_outbox
         SET last_error=$3,
             next_attempt_at=CASE WHEN attempts >= $4 THEN next_attempt_at ELSE now() + ($5::bigint * interval '1 millisecond') END,
             dead_lettered_at=CASE WHEN attempts >= $4 THEN now() ELSE dead_lettered_at END,
             locked_by=NULL,
             locked_at=NULL
         WHERE id=$1 AND published_at IS NULL AND dead_lettered_at IS NULL AND locked_by=$2
         RETURNING *`,
        [eventId, this.workerId, message, max, delay]
      );
      return q.rowCount ? eventRow(q.rows[0]) : null;
    });
  }

  async heartbeat(metadata = {}) {
    const payload = JSON.stringify(metadata || {});
    return this.store.writeDomain(async (client) => {
      await client.query(
        `INSERT INTO sceneshop_worker_heartbeats(worker_id,kind,host,pid,version,metadata,last_seen_at)
         VALUES($1,'OUTBOX',$2,$3,$4,$5::jsonb,now())
         ON CONFLICT(worker_id) DO UPDATE SET
           host=excluded.host,pid=excluded.pid,version=excluded.version,metadata=excluded.metadata,last_seen_at=now()`,
        [this.workerId, metadata.host || null, Number(metadata.pid) || null, metadata.version || null, payload]
      );
      return true;
    });
  }

  async health({ staleWorkerMs = 120000 } = {}) {
    const stale = Math.max(10000, Number(staleWorkerMs) || 120000);
    return this.store.readDomain(async (client) => {
      const q = await client.query(
        `SELECT
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)::int AS pending,
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= now())::int AS ready,
           count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::int AS dead_letters,
           min(created_at) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL) AS oldest_pending_at,
           (SELECT count(*)::int FROM sceneshop_worker_heartbeats WHERE kind='OUTBOX' AND last_seen_at >= now() - ($1::bigint * interval '1 millisecond')) AS active_workers,
           (SELECT max(last_seen_at) FROM sceneshop_worker_heartbeats WHERE kind='OUTBOX') AS last_worker_seen_at
         FROM sceneshop_outbox`,
        [stale]
      );
      const r = q.rows[0] || {};
      const pending = Number(r.pending || 0);
      const deadLetters = Number(r.dead_letters || 0);
      return {
        ok: true,
        backend: 'postgres-outbox',
        pending,
        ready: Number(r.ready || 0),
        deadLetters,
        oldestPendingAt: ms(r.oldest_pending_at),
        activeWorkers: Number(r.active_workers || 0),
        lastWorkerSeenAt: ms(r.last_worker_seen_at),
        degraded: deadLetters > 0,
      };
    });
  }
}

module.exports = { PostgresOutboxRepository, eventRow };
