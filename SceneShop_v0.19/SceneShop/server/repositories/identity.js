/**
 * Domain access layer for identity.
 *
 * v0.9 alpha keeps the v0.8 state object as the backing store, but auth no longer
 * knows how accounts/authors are physically represented. This is the first
 * incremental seam for moving identity to normalized PostgreSQL tables later.
 */
class StateIdentityRepository {
  constructor(getState, save = () => {}) {
    if (typeof getState !== "function") throw new TypeError("getState deve ser uma função.");
    this.getState = getState; this.save = save;
  }

  state() {
    return this.getState();
  }

  normalizeUsername(username) {
    return String(username || "").trim().toLowerCase();
  }

  findAccount(username) {
    const u = this.normalizeUsername(username);
    return this.state().accounts[u] || null;
  }

  findAuthor(id) {
    return this.state().authors[String(id || "")] || null;
  }

  existsUsername(username) {
    const u = this.normalizeUsername(username);
    return !!(this.state().accounts[u] || this.state().authors[u]);
  }

  createIdentity({ account, author }) {
    if (!account || !author || !account.username || !author.id) {
      throw new Error("account e author válidos são obrigatórios.");
    }
    const u = this.normalizeUsername(account.username);
    if (this.existsUsername(u)) {
      const err = new Error("Esse usuário já existe.");
      err.code = "IDENTITY_EXISTS";
      throw err;
    }
    // A mutação dos dois agregados acontece de forma síncrona no mesmo estado;
    // a futura implementação PostgreSQL substituirá isto por uma transação real.
    this.state().authors[author.id] = author;
    this.state().accounts[u] = { ...account, username: u };
    return { account: this.state().accounts[u], author: this.state().authors[author.id] };
  }

  findAccountAuthoritative(username) { return this.findAccount(username); }
  findAuthorAuthoritative(id) { return this.findAuthor(id); }
  existsUsernameAuthoritative(username) { return this.existsUsername(username); }
  createIdentityAuthoritative(args) { return this.createIdentity(args); }
  incrementTokenVersionAuthoritative(username) { return this.incrementTokenVersion(username); }
  createSession({ id, username, tokenVersion, issuedAt, expiresAt, authStrength='PASSWORD', deviceLabel=null }) {
    const u=this.normalizeUsername(username); const acc=this.findAccount(u);
    if (acc) {
      acc.sessions ||= {};
      acc.sessions[id]={ id, tokenVersion:Number(tokenVersion), issuedAt, expiresAt, authStrength, deviceLabel, revokedAt:null };
      const active=Object.values(acc.sessions).filter((x)=>!x.revokedAt && x.expiresAt>Date.now()).sort((a,b)=>b.issuedAt-a.issuedAt);
      active.slice(10).forEach((x)=>{x.revokedAt=Date.now();x.revokedReason='session_limit';});
      this.save();
    }
    return { id, username:u, tokenVersion:Number(tokenVersion), issuedAt, expiresAt, authStrength, deviceLabel };
  }
  verifyPrincipal({ username, tokenVersion, sessionId, mfa=false }) {
    const acc = this.findAccount(username);
    if (!acc || Number(acc.tokenVersion) !== Number(tokenVersion)) return null;
    if (sessionId && acc.sessions) { const ss=acc.sessions[sessionId]; if(!ss || ss.revokedAt || ss.expiresAt<=Date.now()) return null; if(mfa && ss.authStrength!=='MFA') return null; }
    return acc;
  }
  publicPrincipal(username) {
    const account = this.findAccount(username);
    if (!account) return null;
    return { account, author: account.authorId ? this.findAuthor(account.authorId) : null };
  }

  listSessions(username) {
    const acc=this.findAccount(username); if(!acc)return []; const now=Date.now();
    return Object.values(acc.sessions||{}).filter((x)=>!x.revokedAt&&x.expiresAt>now).sort((a,b)=>b.issuedAt-a.issuedAt).map((x)=>({id:x.id,issuedAt:x.issuedAt,expiresAt:x.expiresAt,authStrength:x.authStrength||'PASSWORD',deviceLabel:x.deviceLabel||null}));
  }
  revokeSession(username,sessionId,reason='user_revoked') {
    const acc=this.findAccount(username); const ss=acc&&acc.sessions&&acc.sessions[sessionId]; if(!ss||ss.revokedAt)return false; ss.revokedAt=Date.now();ss.revokedReason=reason;this.save();return true;
  }



  getMfa(username) {
    const acc=this.findAccount(username); return acc && acc.mfa ? { ...acc.mfa } : null;
  }
  saveMfaSetup(username, record) {
    const acc=this.findAccount(username); if(!acc)return null; acc.mfa={...record,enabled:false,createdAt:Date.now(),updatedAt:Date.now()}; this.save(); return {...acc.mfa};
  }
  enableMfa(username) {
    const acc=this.findAccount(username); if(!acc||!acc.mfa)return null; acc.mfa.enabled=true;acc.mfa.verifiedAt=Date.now();acc.mfa.updatedAt=Date.now();this.save();return {...acc.mfa};
  }
  disableMfa(username) {
    const acc=this.findAccount(username); if(!acc)return false; delete acc.mfa; this.save(); return true;
  }

  submitAuthorKyc({ authorId, documentHash, documentMasked, legalName, subjectType, pep, submittedAt }) {
    const author = this.findAuthor(authorId);
    if (!author) return null;
    const duplicate = Object.values(this.state().authors).find((a) => a.id !== authorId && a.kycDocHash === documentHash);
    if (duplicate) {
      const err = new Error("Esse documento já está vinculado a outra conta.");
      err.code = "KYC_DOCUMENT_EXISTS";
      throw err;
    }
    author.kyc = "em_analise";
    author.kycDocHash = documentHash;
    author.document = documentMasked;
    author.kycData = { name: legalName, pep: !!pep, submittedAt, type: subjectType };
    return author;
  }

  decideAuthorKyc(authorId, status) {
    const author = this.findAuthor(authorId);
    if (!author) return null;
    author.kyc = status;
    return author;
  }

  listPendingKyc() {
    return Object.values(this.state().authors)
      .filter((a) => a.kyc === "em_analise")
      .map(({ id, name, document, kycData }) => ({
        id, name, document, pep: !!(kycData && kycData.pep), type: kycData && kycData.type,
        submittedAt: kycData && kycData.submittedAt,
      }));
  }

  submitAuthorKycAuthoritative(args) { return this.submitAuthorKyc(args); }
  decideAuthorKycAuthoritative(authorId, status, opts) { return this.decideAuthorKyc(authorId, status, opts); }
  listPendingKycAuthoritative() { return this.listPendingKyc(); }

  adminUpdateAccount(username, { pass, role, platformAdmin } = {}) {
    const acc = this.findAccount(username);
    if (!acc) return null;
    if (pass) acc.pass = pass;
    if (role) acc.role = role;
    if (platformAdmin != null) acc.platformAdmin = !!platformAdmin;
    acc.tokenVersion = Number(acc.tokenVersion || 0) + 1;
    this.save();
    return acc;
  }
  incrementTokenVersion(username) {
    const acc = this.findAccount(username);
    if (!acc) return null;
    acc.tokenVersion = Number(acc.tokenVersion || 0) + 1;
    return acc;
  }
}

module.exports = { StateIdentityRepository };
