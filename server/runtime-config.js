'use strict';
const PLACEHOLDER_RE = /(replace[-_ ]?with|changeme|example|demo1234|password|secret123)/i;
function urlCheck(value, protocols, label) {
  if (!value) return `${label} ausente`;
  try {
    const u = new URL(value);
    if (!protocols.includes(u.protocol)) return `${label} deve usar ${protocols.join(' ou ')}`;
    if (!u.hostname) return `${label} sem hostname`;
    return null;
  } catch (_) { return `${label} inválida`; }
}
function validateProductionRuntime(config, env = process.env) {
  const errors = [];
  const warnings = [];
  if (!config || !config.IS_PRODUCTION) return { ok: true, production: false, errors, warnings };
  const secret = String(env.SESSION_SECRET || '');
  if (secret.length < 32) errors.push('SESSION_SECRET deve ter >=32 caracteres');
  else if (PLACEHOLDER_RE.test(secret)) errors.push('SESSION_SECRET não pode ser placeholder conhecido');
  const publicErr = urlCheck(env.PUBLIC_URL || '', ['https:'], 'PUBLIC_URL');
  if (publicErr) errors.push(publicErr);
  else {
    const u = new URL(env.PUBLIC_URL);
    if (u.username || u.password || u.search || u.hash) errors.push('PUBLIC_URL não deve conter credenciais, query ou fragmento');
  }
  if (config.DEMO) errors.push('DEMO deve ser 0 em produção');
  if (config.DATA_BACKEND !== 'postgres') errors.push('DATA_BACKEND deve ser postgres');
  const dbErr = urlCheck(config.DATABASE_URL, ['postgres:', 'postgresql:'], 'DATABASE_URL');
  if (dbErr) errors.push(dbErr);
  if (config.SESSION_BACKEND !== 'redis') errors.push('SESSION_BACKEND deve ser redis');
  if (config.CACHE_BACKEND !== 'redis') errors.push('CACHE_BACKEND deve ser redis');
  const redisErr = urlCheck(config.REDIS_URL, ['redis:', 'rediss:'], 'REDIS_URL');
  if (redisErr) errors.push(redisErr);
  if (!/^[A-Za-z0-9:_-]{3,80}$/.test(String(config.CACHE_PREFIX || ''))) errors.push('CACHE_PREFIX inválido');
  if (!config.TRUST_PROXY) warnings.push('TRUST_PROXY=0: correto apenas quando TLS/proxy headers não dependem de proxy reverso');
  if (env.OUTBOX_WEBHOOK_URL) {
    const webhookErr = urlCheck(env.OUTBOX_WEBHOOK_URL, ['https:'], 'OUTBOX_WEBHOOK_URL');
    if (webhookErr) errors.push(webhookErr);
    if (!env.OUTBOX_WEBHOOK_SECRET || String(env.OUTBOX_WEBHOOK_SECRET).length < 24) errors.push('OUTBOX_WEBHOOK_SECRET deve ter >=24 caracteres quando webhook estiver habilitado');
  }
  return { ok: errors.length === 0, production: true, errors, warnings };
}
function assertProductionRuntime(config, env = process.env) {
  const report = validateProductionRuntime(config, env);
  if (!report.ok) {
    const error = new Error(`Configuração de produção inválida: ${report.errors.join('; ')}.`);
    error.code = 'SCENESHOP_INVALID_PRODUCTION_CONFIG';
    error.report = report;
    throw error;
  }
  return report;
}
module.exports = { validateProductionRuntime, assertProductionRuntime };
