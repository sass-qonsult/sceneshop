// Hash de senha com scrypt + sal aleatório (formato "sal:hash")
const crypto = require("crypto");

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(String(pw), salt, 32).toString("hex")}`;
}

function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash || hash.length !== 64) return false;
  const got = crypto.scryptSync(String(pw), salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, "hex"));
}

// hash descartável: usado quando o usuário não existe, para o tempo de resposta ser igual
const DUMMY = hashPassword("dummy-password");

module.exports = { hashPassword, checkPassword, DUMMY };
