const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of Buffer.from(buffer)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Segredo Base32 inválido.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  const big = BigInt(counter);
  buf.writeBigUInt64BE(big);
  const digest = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(bin % (10 ** digits)).padStart(digits, '0');
}

function totp(secret, at = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(Number(at) / 1000 / stepSeconds);
  return hotp(secret, counter, digits);
}

function safeEqualCode(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifyTotp(code, secret, { at = Date.now(), window = 1, stepSeconds = 30, digits = 6 } = {}) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return false;
  const baseCounter = Math.floor(Number(at) / 1000 / stepSeconds);
  for (let delta = -Math.abs(window); delta <= Math.abs(window); delta += 1) {
    if (safeEqualCode(clean, hotp(secret, baseCounter + delta, digits))) return true;
  }
  return false;
}

function keyFromMaster(masterSecret) {
  if (!masterSecret || String(masterSecret).length < 16) throw new Error('Segredo mestre insuficiente para MFA.');
  return crypto.createHash('sha256').update(String(masterSecret)).digest();
}

function encryptSecret(secret, masterSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromMaster(masterSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptSecret(record, masterSecret) {
  if (!record || !record.ciphertext || !record.iv || !record.tag) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromMaster(masterSecret), Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function otpauthUri({ secret, account, issuer = 'SceneShop' }) {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  base32Encode, base32Decode, generateSecret, hotp, totp, verifyTotp,
  encryptSecret, decryptSecret, otpauthUri,
};
