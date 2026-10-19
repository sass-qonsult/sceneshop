const crypto = require("crypto");
const audit = require("../audit");

const normalizeUsername = (username) => String(username || "").trim().toLowerCase();
const millis = (value) => value == null ? null : new Date(value).getTime();


async function insertAuditRow(client, entry) {
  await client.query(
    `INSERT INTO sceneshop_audit_log(seq,occurred_at,actor,action,data,prev_hash,entry_hash,payload)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)`,
    [entry.seq, new Date(entry.at), entry.actor, entry.action, JSON.stringify(entry.data || {}),
     entry.prev, entry.hash, JSON.stringify(entry)]
  );
}

function accountFromRow(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    ...payload,
    username: row.username,
    pass: row.password_hash,
    role: row.role,
    authorId: row.author_id || null,
    tokenVersion: Number(row.token_version || 0),
    demo: !!row.demo,
    createdAt: millis(row.created_at),
  };
}

function authorFromRow(row, prefix = "") {
  if (!row) return null;
  const get = (name) => row[`${prefix}${name}`];
  const id = get("id");
  if (!id) return null;
  const payload = get("payload") && typeof get("payload") === "object" ? get("payload") : {};
  return {
    ...payload,
    id,
    name: get("name") || id,
    type: get("type") || "community",
    partnerId: get("partner_id") || null,
    managedBy: get("managed_by") || null,
    kyc: get("kyc_status") || "pendente",
    document: get("document") || null,
  };
}

class PostgresIdentityRepository {
  constructor({ store }) {
    if (!store) throw new TypeError("store é obrigatório.");
    this.store = store;
  }

  normalizeUsername(username) { return normalizeUsername(username); }

  async findAccount(username) {
    const u = normalizeUsername(username);
    if (!u) return null;
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT username,password_hash,role,author_id,token_version,demo,created_at,payload
           FROM sceneshop_accounts WHERE username=$1`, [u]
      );
      return r.rowCount ? accountFromRow(r.rows[0]) : null;
    });
  }

  async findAuthor(id) {
    const key = String(id || "");
    if (!key) return null;
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT id,name,type,partner_id,managed_by,kyc_status,document,payload
           FROM sceneshop_authors WHERE id=$1`, [key]
      );
      return r.rowCount ? authorFromRow(r.rows[0]) : null;
    });
  }

  async existsUsername(username) {
    const u = normalizeUsername(username);
    if (!u) return false;
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT EXISTS(
           SELECT 1 FROM sceneshop_accounts WHERE username=$1
           UNION ALL
           SELECT 1 FROM sceneshop_authors WHERE id=$1
         ) AS found`, [u]
      );
      return !!(r.rows[0] && r.rows[0].found);
    });
  }

  async publicPrincipal(username) {
    const u = normalizeUsername(username);
    if (!u) return null;
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT a.username,a.password_hash,a.role,a.author_id,a.token_version,a.demo,a.created_at,a.payload,
                au.id AS author_id_join,au.name AS author_name,au.type AS author_type,
                au.partner_id AS author_partner_id,au.managed_by AS author_managed_by,
                au.kyc_status AS author_kyc_status,au.document AS author_document,au.payload AS author_payload
           FROM sceneshop_accounts a
           LEFT JOIN sceneshop_authors au ON au.id=a.author_id
          WHERE a.username=$1`, [u]
      );
      if (!r.rowCount) return null;
      const row = r.rows[0];
      return {
        account: accountFromRow(row),
        author: authorFromRow({
          author_id: row.author_id_join,
          author_name: row.author_name,
          author_type: row.author_type,
          author_partner_id: row.author_partner_id,
          author_managed_by: row.author_managed_by,
          author_kyc_status: row.author_kyc_status,
          author_document: row.author_document,
          author_payload: row.author_payload,
        }, "author_"),
      };
    });
  }

  async verifyPrincipal({ username, tokenVersion, sessionId, mfa=false }) {
    const u = normalizeUsername(username);
    if (!u) return null;
    return this.store.readDomain(async (client) => {
      const sessionSql = sessionId ? `AND EXISTS (
          SELECT 1 FROM sceneshop_auth_sessions s
           WHERE s.id=$2 AND s.username=a.username
             AND s.revoked_at IS NULL AND s.expires_at > now()
             AND s.token_version=a.token_version
             ${mfa ? "AND s.auth_strength='MFA'" : ""}
        )` : "";
      const tokenParam = sessionId ? "$3" : "$2";
      const r = await client.query(
        `SELECT a.username,a.password_hash,a.role,a.author_id,a.token_version,a.demo,a.created_at,a.payload,
                au.id AS author_id_join,au.name AS author_name,au.type AS author_type,
                au.partner_id AS author_partner_id,au.managed_by AS author_managed_by,
                au.kyc_status AS author_kyc_status,au.document AS author_document,au.payload AS author_payload
           FROM sceneshop_accounts a
           LEFT JOIN sceneshop_authors au ON au.id=a.author_id
          WHERE a.username=$1 AND a.token_version=${tokenParam} ${sessionSql}`,
        sessionId ? [u, String(sessionId), Number(tokenVersion)] : [u, Number(tokenVersion)]
      );
      if (!r.rowCount) return null;
      const row = r.rows[0];
      const account = accountFromRow(row);
      account._author = authorFromRow({
        author_id: row.author_id_join,
        author_name: row.author_name,
        author_type: row.author_type,
        author_partner_id: row.author_partner_id,
        author_managed_by: row.author_managed_by,
        author_kyc_status: row.author_kyc_status,
        author_document: row.author_document,
        author_payload: row.author_payload,
      }, "author_");
      return account;
    });
  }

  async createSession({ id = crypto.randomUUID(), username, tokenVersion, issuedAt, expiresAt, ipHash = null, metadata = {}, authStrength='PASSWORD', deviceLabel=null }) {
    const u = normalizeUsername(username);
    return this.store.writeDomain(async (client) => {
      await client.query(
        `INSERT INTO sceneshop_auth_sessions(id,username,token_version,issued_at,expires_at,ip_hash,metadata,auth_strength,last_seen_at,device_label)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now(),$9)`,
        [id, u, Number(tokenVersion), new Date(issuedAt), new Date(expiresAt), ipHash, JSON.stringify(metadata || {}), authStrength, deviceLabel]
      );
      await client.query(`UPDATE sceneshop_auth_sessions SET revoked_at=now(),revoked_reason='session_limit' WHERE id IN (SELECT id FROM sceneshop_auth_sessions WHERE username=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY issued_at DESC OFFSET 10)`,[u]);
      await client.query("UPDATE sceneshop_accounts SET last_login_at=now(),updated_at=now() WHERE username=$1", [u]);
      return { id, username: u, tokenVersion: Number(tokenVersion), issuedAt, expiresAt, authStrength, deviceLabel };
    });
  }

  async getMfa(username) {
    const u=normalizeUsername(username);
    return this.store.readDomain(async(client)=>{
      const q=await client.query('SELECT username,method,secret_ciphertext,secret_iv,secret_tag,enabled,verified_at,created_at,updated_at FROM sceneshop_account_mfa WHERE username=$1',[u]);
      if(!q.rowCount)return null; const r=q.rows[0];
      return {username:r.username,method:r.method,ciphertext:r.secret_ciphertext,iv:r.secret_iv,tag:r.secret_tag,enabled:!!r.enabled,verifiedAt:millis(r.verified_at),createdAt:millis(r.created_at),updatedAt:millis(r.updated_at)};
    });
  }
  async saveMfaSetup(username,record) {
    const u=normalizeUsername(username);
    return this.store.writeDomain(async(client)=>{
      const q=await client.query(`INSERT INTO sceneshop_account_mfa(username,method,secret_ciphertext,secret_iv,secret_tag,enabled,updated_at) VALUES($1,'TOTP',$2,$3,$4,false,now()) ON CONFLICT(username) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext,secret_iv=EXCLUDED.secret_iv,secret_tag=EXCLUDED.secret_tag,enabled=false,verified_at=NULL,updated_at=now() RETURNING *`,[u,record.ciphertext,record.iv,record.tag]);
      const r=q.rows[0];return{username:r.username,method:r.method,ciphertext:r.secret_ciphertext,iv:r.secret_iv,tag:r.secret_tag,enabled:!!r.enabled,createdAt:millis(r.created_at),updatedAt:millis(r.updated_at)};
    });
  }
  async enableMfa(username) {
    const u=normalizeUsername(username);return this.store.writeDomain(async(client)=>{const q=await client.query('UPDATE sceneshop_account_mfa SET enabled=true,verified_at=now(),updated_at=now() WHERE username=$1 RETURNING *',[u]);return q.rowCount?{enabled:true,verifiedAt:millis(q.rows[0].verified_at)}:null;});
  }
  async disableMfa(username) {
    const u=normalizeUsername(username);return this.store.writeDomain(async(client)=>{await client.query('DELETE FROM sceneshop_account_mfa WHERE username=$1',[u]);return true;});
  }

  async listSessions(username) {
    const u=normalizeUsername(username);return this.store.readDomain(async(client)=>{const q=await client.query(`SELECT id,issued_at,expires_at,auth_strength,device_label,last_seen_at FROM sceneshop_auth_sessions WHERE username=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY issued_at DESC`,[u]);return q.rows.map((r)=>({id:r.id,issuedAt:millis(r.issued_at),expiresAt:millis(r.expires_at),authStrength:r.auth_strength||'PASSWORD',deviceLabel:r.device_label||null,lastSeenAt:millis(r.last_seen_at)}));});
  }
  async revokeSession(username,sessionId,reason='user_revoked') {
    const u=normalizeUsername(username);return this.store.writeDomain(async(client)=>{const q=await client.query(`UPDATE sceneshop_auth_sessions SET revoked_at=now(),revoked_reason=$3 WHERE id=$1 AND username=$2 AND revoked_at IS NULL RETURNING id`,[sessionId,u,reason]);return q.rowCount>0;});
  }

  async createIdentity({ account, author, session }) {
    const u = normalizeUsername(account && account.username);
    if (!u || !author || !author.id) throw new Error("account e author válidos são obrigatórios.");
    try {
      const committed = await this.store.atomicDomain(async (draft) => {
        if (draft.accounts[u] || draft.authors[author.id]) {
          const err = new Error("Esse usuário já existe.");
          err.code = "IDENTITY_EXISTS";
          throw err;
        }
        const normalizedAccount = { ...account, username: u };
        draft.authors[author.id] = author;
        draft.accounts[u] = normalizedAccount;
        return {
          snapshot: draft,
          topic: "identity.created",
          aggregateType: "account",
          aggregateId: u,
          outboxPayload: { username: u, authorId: author.id, role: normalizedAccount.role },
          result: { account: normalizedAccount, author },
          write: async (client) => {
            await client.query(
              `INSERT INTO sceneshop_authors(id,name,type,partner_id,managed_by,kyc_status,document,payload,updated_at)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())`,
              [author.id, author.name || author.id, author.type || "community", author.partnerId || null,
               author.managedBy || null, author.kyc || "pendente", author.document || null, JSON.stringify(author)]
            );
            await client.query(
              `INSERT INTO sceneshop_accounts(username,password_hash,role,author_id,token_version,demo,created_at,payload,updated_at)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())`,
              [u, normalizedAccount.pass || "", normalizedAccount.role || "author", normalizedAccount.authorId || null,
               Number(normalizedAccount.tokenVersion || 1), !!normalizedAccount.demo,
               normalizedAccount.createdAt ? new Date(normalizedAccount.createdAt) : new Date(), JSON.stringify(normalizedAccount)]
            );
            if (session) {
              await client.query(
                `INSERT INTO sceneshop_auth_sessions(id,username,token_version,issued_at,expires_at,ip_hash,metadata)
                 VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
                [session.id, u, Number(session.tokenVersion), new Date(session.issuedAt), new Date(session.expiresAt),
                 session.ipHash || null, JSON.stringify(session.metadata || {})]
              );
            }
            return { created: true };
          },
        };
      });
      return committed.result;
    } catch (err) {
      if (err && err.code === "23505") {
        const e = new Error("Esse usuário já existe.");
        e.code = "IDENTITY_EXISTS";
        throw e;
      }
      throw err;
    }
  }


  async submitAuthorKyc({ authorId, documentHash, documentMasked, legalName, subjectType, pep, submittedAt, actor = "sistema" }) {
    const key = String(authorId || "");
    if (!key) return null;
    try {
      const committed = await this.store.atomicDomain(async (draft) => {
        const author = draft.authors[key];
        if (!author) return { snapshot: draft, result: null, write: async () => ({ skipSnapshot: true }) };
        author.kyc = "em_analise";
        author.kycDocHash = documentHash;
        author.document = documentMasked;
        author.kycData = { name: legalName, pep: !!pep, submittedAt, type: subjectType };
        const entry = audit.prepareEntry(draft.audit || (draft.audit = []), actor, "kyc_enviado",
          { authorId: key, tipo: subjectType, pep: !!pep }, submittedAt);
        draft.audit.push(entry);
        return {
          snapshot: draft,
          topic: "identity.kyc.submitted",
          aggregateType: "author",
          aggregateId: key,
          outboxPayload: { authorId: key, status: "em_analise", subjectType, pep: !!pep },
          result: author,
          write: async (client) => {
            const exists = await client.query("SELECT 1 FROM sceneshop_authors WHERE id=$1", [key]);
            if (!exists.rowCount) return { skipSnapshot: true, missing: true };
            await client.query(
              `INSERT INTO sceneshop_author_kyc(
                 author_id,status,document_hash,document_masked,legal_name,subject_type,pep,submitted_at,metadata,updated_at)
               VALUES($1,'em_analise',$2,$3,$4,$5,$6,$7,$8::jsonb,now())
               ON CONFLICT(author_id) DO UPDATE SET
                 status='em_analise',document_hash=EXCLUDED.document_hash,document_masked=EXCLUDED.document_masked,
                 legal_name=EXCLUDED.legal_name,subject_type=EXCLUDED.subject_type,pep=EXCLUDED.pep,
                 submitted_at=EXCLUDED.submitted_at,reviewed_at=NULL,reviewed_by=NULL,updated_at=now()`,
              [key, documentHash, documentMasked, legalName, subjectType, !!pep, new Date(submittedAt), JSON.stringify({})]
            );
            await client.query(
              `UPDATE sceneshop_authors
                  SET kyc_status='em_analise',document=$2,payload=$3::jsonb,updated_at=now()
                WHERE id=$1`,
              [key, documentMasked, JSON.stringify(author)]
            );
            await insertAuditRow(client, entry);
            return { submitted: true };
          },
        };
      });
      return committed.result;
    } catch (err) {
      if (err && err.code === "23505") {
        const e = new Error("Esse documento já está vinculado a outra conta.");
        e.code = "KYC_DOCUMENT_EXISTS";
        throw e;
      }
      throw err;
    }
  }

  async decideAuthorKyc(authorId, status, { actor = "sistema", at = Date.now() } = {}) {
    const key = String(authorId || "");
    if (!key) return null;
    const committed = await this.store.atomicDomain(async (draft) => {
      const author = draft.authors[key];
      if (!author) return { snapshot: draft, result: null, write: async () => ({ skipSnapshot: true }) };
      author.kyc = status;
      const entry = audit.prepareEntry(draft.audit || (draft.audit = []), actor, "kyc_decisao",
        { authorId: key, status }, at);
      draft.audit.push(entry);
      return {
        snapshot: draft,
        topic: "identity.kyc.decided",
        aggregateType: "author",
        aggregateId: key,
        outboxPayload: { authorId: key, status, actor },
        result: author,
        write: async (client) => {
          await client.query(
            `INSERT INTO sceneshop_author_kyc(author_id,status,reviewed_at,reviewed_by,metadata,updated_at)
             VALUES($1,$2,$3,$4,'{}'::jsonb,now())
             ON CONFLICT(author_id) DO UPDATE SET
               status=EXCLUDED.status,reviewed_at=EXCLUDED.reviewed_at,reviewed_by=EXCLUDED.reviewed_by,updated_at=now()`,
            [key, status, new Date(at), actor]
          );
          await client.query(
            `UPDATE sceneshop_authors SET kyc_status=$2,payload=$3::jsonb,updated_at=now() WHERE id=$1`,
            [key, status, JSON.stringify(author)]
          );
          await insertAuditRow(client, entry);
          return { decided: true };
        },
      };
    });
    return committed.result;
  }

  async listPendingKyc() {
    return this.store.readDomain(async (client) => {
      const r = await client.query(
        `SELECT a.id,a.name,k.document_masked AS document,k.pep,k.subject_type,k.submitted_at
           FROM sceneshop_author_kyc k
           JOIN sceneshop_authors a ON a.id=k.author_id
          WHERE k.status='em_analise'
          ORDER BY k.submitted_at ASC NULLS LAST, a.id`
      );
      return r.rows.map((row) => ({
        id: row.id, name: row.name, document: row.document, pep: !!row.pep,
        type: row.subject_type, submittedAt: millis(row.submitted_at),
      }));
    });
  }

  /** Ferramenta de administração: troca senha/papel/flags e derruba as sessões abertas. */
  async adminUpdateAccount(username, { pass, role, platformAdmin } = {}) {
    const u = normalizeUsername(username);
    const committed = await this.store.atomicDomain(async (draft) => {
      const current = draft.accounts[u];
      if (!current) return { snapshot: draft, result: null, write: async () => ({ skipSnapshot: true }) };
      if (pass) current.pass = pass;
      if (role) current.role = role;
      if (platformAdmin != null) current.platformAdmin = !!platformAdmin;
      current.tokenVersion = Number(current.tokenVersion || 0) + 1;
      return {
        snapshot: draft, topic: "identity.admin.updated", aggregateType: "account", aggregateId: u,
        outboxPayload: { username: u, role: current.role, platformAdmin: !!current.platformAdmin },
        result: current,
        write: async (client) => {
          await client.query(
            `UPDATE sceneshop_accounts SET password_hash=$2,role=$3,token_version=$4,payload=$5::jsonb,updated_at=now() WHERE username=$1`,
            [u, current.pass, current.role, current.tokenVersion, JSON.stringify(current)]);
          await client.query(`UPDATE sceneshop_auth_sessions SET revoked_at=now(),revoked_reason='admin_update' WHERE username=$1 AND revoked_at IS NULL`, [u]);
          return { updated: true };
        },
      };
    });
    return committed.result;
  }

  async incrementTokenVersion(username, { reason = "logout_all", at = Date.now() } = {}) {
    const u = normalizeUsername(username);
    const committed = await this.store.atomicDomain(async (draft) => {
      const current = draft.accounts[u];
      if (!current) return { snapshot: draft, result: null, write: async () => ({ skipSnapshot: true }) };
      const next = Number(current.tokenVersion || 0) + 1;
      current.tokenVersion = next;
      return {
        snapshot: draft,
        topic: "identity.tokens.revoked",
        aggregateType: "account",
        aggregateId: u,
        outboxPayload: { username: u, tokenVersion: next, reason },
        result: current,
        write: async (client) => {
          const r = await client.query(
            `UPDATE sceneshop_accounts
                SET token_version=token_version+1,updated_at=now()
              WHERE username=$1
              RETURNING token_version`, [u]
          );
          if (!r.rowCount) return { skipSnapshot: true, missing: true };
          const dbNext = Number(r.rows[0].token_version);
          if (dbNext !== next) {
            const err = new Error("tokenVersion PostgreSQL divergiu do snapshot de compatibilidade.");
            err.code = "IDENTITY_REVISION_CONFLICT";
            throw err;
          }
          await client.query(
            `UPDATE sceneshop_auth_sessions
                SET revoked_at=$2,revoked_reason=$3
              WHERE username=$1 AND revoked_at IS NULL`, [u, new Date(at), reason]
          );
          return { tokenVersion: dbNext };
        },
      };
    });
    return committed.result;
  }
}

module.exports = { PostgresIdentityRepository, accountFromRow, authorFromRow, normalizeUsername };
