const crypto = require('crypto');

function createHttpPublisher({ url, secret = '', timeoutMs = 10000 } = {}) {
  const endpoint = new URL(String(url || ''));
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('OUTBOX_WEBHOOK_URL deve usar HTTP/HTTPS.');
  if (process.env.NODE_ENV === 'production' && endpoint.protocol !== 'https:') throw new Error('OUTBOX_WEBHOOK_URL deve usar HTTPS em produção.');
  const timeout = Math.max(500, Math.min(60000, Number(timeoutMs) || 10000));
  return async function publish(event, context = {}) {
    const body = JSON.stringify({
      id: event.id,
      topic: event.topic,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      createdAt: event.createdAt,
      attempt: event.attempts,
    });
    const headers = {
      'content-type': 'application/json',
      'x-sceneshop-event-id': String(event.id),
      'x-sceneshop-topic': event.topic,
    };
    if (context.traceparent) headers.traceparent = context.traceparent;
    if (secret) headers['x-sceneshop-signature'] = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const res = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 500);
      throw new Error(`Outbox webhook HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return { ok: true, status: res.status };
  };
}

module.exports = { createHttpPublisher };
