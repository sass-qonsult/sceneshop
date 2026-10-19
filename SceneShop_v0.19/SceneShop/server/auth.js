/**
 * Contas, senhas e permissões.
 *
 * v0.9 alpha.5:
 * - file/memory: mantém o fluxo síncrono legado para compatibilidade.
 * - postgres: contas, tokenVersion e sessões de login são lidos do PostgreSQL
 *   autoritativamente. O snapshot passa a ser apenas uma visão de compatibilidade.
 */
const crypto = require("crypto");
const store = require("./store");
const audit = require("./audit");
const { identity } = require("./repositories");
const { TOKEN_TTL_DAYS, DEMO } = require("./config");
const { hashPassword, checkPassword, DUMMY } = require("./passwords");
const mfa = require("./security/mfa");

const S = () => store.state;
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const secret = () => process.env.SESSION_SECRET || S().secret;
const isPromise = (v) => !!v && typeof v.then === "function";

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = b64(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${mac}`;
}

function decodeVerified(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expect = b64(crypto.createHmac("sha256", secret()).update(body).digest());
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.sub || !Number.isFinite(Number(p.v)) || Number(p.exp) < Date.now()) return null;
    return p;
  } catch (_) {
    return null;
  }
}

function verify(token) {
  const p = decodeVerified(token);
  if (!p) return null;
  const principal = identity.verifyPrincipal({ username: p.sub, tokenVersion: p.v, sessionId: p.sid || null, mfa: !!p.mfa });
  const finish = (acc) => {
    if (!acc) return null;
    acc._auth = { mfa: !!p.mfa, sid: p.sid || null };
    return acc;
  };
  return isPromise(principal) ? principal.then(finish) : finish(principal);
}

function publicUser(acc) {
  const author = acc && (acc._author || (acc.authorId ? identity.findAuthor(acc.authorId) : null));
  return {
    username: acc.username,
    role: acc.role,
    authorId: acc.authorId,
    name: author ? author.name : acc.username,
    kyc: author ? author.kyc : null,
    platformAdmin: !!acc.platformAdmin,
  };
}

function publicUserAuthoritative(acc) {
  if (!acc) return null;
  if (acc._author) return publicUser(acc);
  const principal = identity.publicPrincipal(acc.username);
  const finish = (r) => r ? publicUser({ ...r.account, _author: r.author }) : publicUser(acc);
  return isPromise(principal) ? principal.then(finish) : finish(principal);
}

function sessionDescriptor(acc, ip, { id = crypto.randomUUID(), issuedAt = Date.now(), authStrength = "PASSWORD", deviceLabel = null } = {}) {
  const expiresAt = issuedAt + TOKEN_TTL_DAYS * 864e5;
  const ipHash = ip ? crypto.createHmac("sha256", secret()).update(String(ip)).digest("hex") : null;
  return {
    id, username: acc.username, tokenVersion: Number(acc.tokenVersion || 0), issuedAt, expiresAt, ipHash,
    authStrength, deviceLabel, metadata: { source: authStrength === "MFA" ? "password+totp" : "password" },
  };
}

function issue(acc, session = {}) {
  const exp = Number(session.expiresAt || (Date.now() + TOKEN_TTL_DAYS * 864e5));
  const payload = { sub: acc.username, v: acc.tokenVersion, exp };
  if (session.id) payload.sid = session.id;
  if (session.authStrength === "MFA") payload.mfa = true;
  return sign(payload);
}

function startAuthenticatedSession(acc, ip, { authStrength = "PASSWORD", deviceLabel = null } = {}) {
  const session = sessionDescriptor(acc, ip, { authStrength, deviceLabel });
  const created = identity.createSession(session);
  const done = () => {
    audit.log(acc.username, "login", { username: acc.username, ip, authStrength });
    const user = publicUserAuthoritative(acc);
    const response = (u) => ({ token: issue(acc, session), user: u });
    return isPromise(user) ? user.then(response) : response(user);
  };
  return isPromise(created) ? created.then(done) : done();
}

function mfaChallenge(acc) {
  return sign({ sub: acc.username, v: Number(acc.tokenVersion || 0), exp: Date.now() + 5 * 60e3, purpose: "mfa-login", nonce: crypto.randomUUID() });
}

function finishLogin(acc, password, ip, requestedUsername) {
  const allowed = acc && (DEMO || !acc.demo);
  const ok = checkPassword(password, allowed ? acc.pass : DUMMY) && !!allowed;
  if (!ok) {
    audit.log("anônimo", "login_falhou", { username: String((acc && acc.username) || requestedUsername || "").slice(0, 30), ip });
    return { error: "Usuário ou senha inválidos." };
  }
  const config = identity.getMfaAuthoritative(acc.username);
  const finish = (record) => {
    if (record && record.enabled) {
      audit.log(acc.username, "login_mfa_requerido", { username: acc.username, ip });
      return { mfaRequired: true, challenge: mfaChallenge(acc), user: { username: acc.username } };
    }
    return startAuthenticatedSession(acc, ip);
  };
  return isPromise(config) ? config.then(finish) : finish(config);
}

function login(username, password, ip) {
  const found = identity.findAccountAuthoritative(username);
  const finish = (acc) => finishLogin(acc, password, ip, username);
  return isPromise(found) ? found.then(finish) : finish(found);
}

function signup({ username, password, name }, ip) {
  const u = String(username || "").trim().toLowerCase();
  const errors = [];
  if (!/^[a-z0-9_]{3,24}$/.test(u)) errors.push("Usuário: 3 a 24 letras minúsculas, números ou _.");
  if (String(password || "").length < 8) errors.push("A senha precisa de ao menos 8 caracteres.");
  if (errors.length) return { errors };

  const exists = identity.existsUsernameAuthoritative(u);
  const continueSignup = (taken) => {
    if (taken) return { errors: ["Esse usuário já existe."] };
    const account = { username: u, pass: hashPassword(password), role: "author", authorId: u, tokenVersion: 1, createdAt: store.now() };
    const author = { id: u, name: String(name || u).slice(0, 40), type: "community", kyc: "pendente", document: null };
    const session = sessionDescriptor(account, ip);
    const created = identity.createIdentityAuthoritative({ account, author, session });
    const finish = (r) => {
      audit.log(u, "conta_criada", { ip });
      return { token: issue(r.account, session), user: publicUser({ ...r.account, _author: r.author }) };
    };
    const failed = (err) => {
      if (err && err.code === "IDENTITY_EXISTS") return { errors: ["Esse usuário já existe."] };
      throw err;
    };
    return isPromise(created) ? created.then(finish, failed) : finish(created);
  };
  return isPromise(exists) ? exists.then(continueSignup) : continueSignup(exists);
}

function completeMfaLogin(challenge, code, ip) {
  const p = decodeVerified(challenge);
  if (!p || p.purpose !== "mfa-login") return { error: "Desafio MFA inválido ou expirado." };
  const found = identity.findAccountAuthoritative(p.sub);
  const proceed = (acc) => {
    if (!acc || Number(acc.tokenVersion) !== Number(p.v)) return { error: "Desafio MFA inválido ou expirado." };
    const config = identity.getMfaAuthoritative(acc.username);
    const check = (record) => {
      if (!record || !record.enabled) return { error: "MFA não está habilitado para esta conta." };
      let plain;
      try { plain = mfa.decryptSecret(record, secret()); } catch (_) { return { error: "MFA indisponível." }; }
      if (!mfa.verifyTotp(code, plain, { window: 1 })) {
        audit.log(acc.username, "login_mfa_falhou", { ip });
        return { error: "Código MFA inválido." };
      }
      return startAuthenticatedSession(acc, ip, { authStrength: "MFA" });
    };
    return isPromise(config) ? config.then(check) : check(config);
  };
  return isPromise(found) ? found.then(proceed) : proceed(found);
}

function setupMfa(username) {
  const secretValue = mfa.generateSecret();
  const encrypted = mfa.encryptSecret(secretValue, secret());
  const saved = identity.saveMfaSetupAuthoritative(username, encrypted);
  const finish = () => ({ secret: secretValue, otpauth: mfa.otpauthUri({ secret: secretValue, account: username }) });
  return isPromise(saved) ? saved.then(finish) : finish();
}

function enableMfa(username, code) {
  const record = identity.getMfaAuthoritative(username);
  const finish = (r) => {
    if (!r) return { error: "Inicie a configuração do MFA primeiro." };
    let plain; try { plain = mfa.decryptSecret(r, secret()); } catch (_) { return { error: "Configuração MFA inválida." }; }
    if (!mfa.verifyTotp(code, plain, { window: 1 })) return { error: "Código MFA inválido." };
    const enabled = identity.enableMfaAuthoritative(username);
    const done = () => { audit.log(username, "mfa_habilitado", {}); return { ok: true, enabled: true }; };
    return isPromise(enabled) ? enabled.then(done) : done();
  };
  return isPromise(record) ? record.then(finish) : finish(record);
}

function disableMfa(username, code) {
  const record = identity.getMfaAuthoritative(username);
  const finish = (r) => {
    if (!r || !r.enabled) return { error: "MFA não está habilitado." };
    let plain; try { plain = mfa.decryptSecret(r, secret()); } catch (_) { return { error: "Configuração MFA inválida." }; }
    if (!mfa.verifyTotp(code, plain, { window: 1 })) return { error: "Código MFA inválido." };
    const disabled = identity.disableMfaAuthoritative(username);
    const done = async () => { await Promise.resolve(logoutAll(username)); audit.log(username, "mfa_desabilitado", {}); return { ok: true, enabled: false, sessionsRevoked: true }; };
    return isPromise(disabled) ? disabled.then(done) : done();
  };
  return isPromise(record) ? record.then(finish) : finish(record);
}

function logoutAll(username) {
  return identity.incrementTokenVersionAuthoritative(username, { reason: "logout_all", at: store.now() });
}

// ---------------------------------------------------------------- middlewares
function attach(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }
  try {
    const result = verify(h.slice(7));
    if (isPromise(result)) {
      return result.then((user) => { req.user = user; next(); }).catch(next);
    }
    req.user = result;
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Entre na sua conta." });
    // administrador da plataforma: produtora com acesso também às telas de moderação
    const ok = !roles.length || roles.includes(req.user.role) || (req.user.platformAdmin && roles.includes("moderator"));
    if (!ok) return res.status(403).json({ error: "Sem permissão para esta ação." });
    next();
  };
}

module.exports = {
  hashPassword, checkPassword, login, signup, logoutAll, attach, requireRole,
  publicUser, publicUserAuthoritative, verify, issue, decodeVerified,
  completeMfaLogin, setupMfa, enableMfa, disableMfa, startAuthenticatedSession,
};
