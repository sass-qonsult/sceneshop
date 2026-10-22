const crypto = require('crypto');
const { normalizeSlug, normalizeKind, normalizeRole, publicOrg, publicInvite, inviteHash } = require('./organization');
const millis = (v) => v == null ? null : new Date(v).getTime();

function orgFromRow(r) {
  if (!r) return null;
  return { id:r.id, slug:r.slug, name:r.name, kind:r.kind, status:r.status, settings:r.settings || {}, createdBy:r.created_by || null, createdAt:millis(r.created_at), updatedAt:millis(r.updated_at) };
}
function memberFromRow(r) {
  if (!r) return null;
  return { organizationId:r.organization_id, username:r.username, role:r.role, status:r.status, invitedBy:r.invited_by || null, joinedAt:millis(r.joined_at), createdAt:millis(r.created_at), updatedAt:millis(r.updated_at), metadata:r.metadata || {} };
}

class PostgresOrganizationRepository {
  constructor({ store }) { this.store=store; }
  async listForUser(username) {
    const u=String(username||'').toLowerCase();
    return this.store.readDomain(async (c) => {
      const q=await c.query(`SELECT o.*,m.role AS m_role,m.status AS m_status FROM sceneshop_organizations o JOIN sceneshop_organization_members m ON m.organization_id=o.id WHERE m.username=$1 AND m.status='ACTIVE' AND o.status='ACTIVE' ORDER BY o.name`,[u]);
      return q.rows.map((r)=>publicOrg(orgFromRow(r),{role:r.m_role,status:r.m_status}));
    });
  }
  async get(orgId) { return this.store.readDomain(async(c)=>{ const q=await c.query('SELECT * FROM sceneshop_organizations WHERE id=$1',[orgId]); return q.rowCount?orgFromRow(q.rows[0]):null; }); }
  async getMembership(orgId, username) { return this.store.readDomain(async(c)=>{ const q=await c.query('SELECT * FROM sceneshop_organization_members WHERE organization_id=$1 AND username=$2',[orgId,String(username||'').toLowerCase()]); return q.rowCount?memberFromRow(q.rows[0]):null; }); }
  async create({name,slug,kind='OTHER',settings={}},actor) {
    const cleanName=String(name||'').trim().slice(0,120); const cleanSlug=normalizeSlug(slug||cleanName); const cleanKind=normalizeKind(kind);
    if(cleanName.length<2)return{errors:['Nome da organização é obrigatório.']}; if(cleanSlug.length<2)return{errors:['Slug da organização é inválido.']}; if(!cleanKind)return{errors:['Tipo de organização inválido.']};
    const id=`org-${crypto.randomUUID()}`; const u=String(actor||'').toLowerCase();
    try {
      return await this.store.writeDomain(async(c)=>{
        const oq=await c.query(`INSERT INTO sceneshop_organizations(id,slug,name,kind,status,created_by,settings) VALUES($1,$2,$3,$4,'ACTIVE',$5,$6::jsonb) RETURNING *`,[id,cleanSlug,cleanName,cleanKind,u,JSON.stringify(settings||{})]);
        const mq=await c.query(`INSERT INTO sceneshop_organization_members(organization_id,username,role,status,joined_at) VALUES($1,$2,'OWNER','ACTIVE',now()) RETURNING *`,[id,u]);
        return {organization:publicOrg(orgFromRow(oq.rows[0]),memberFromRow(mq.rows[0]))};
      });
    } catch(err) { if(err&&err.code==='23505') return {errors:['Esse identificador de organização já existe.']}; throw err; }
  }
  async listMembers(orgId) { return this.store.readDomain(async(c)=>{ const q=await c.query('SELECT * FROM sceneshop_organization_members WHERE organization_id=$1 ORDER BY username',[orgId]); return q.rows.map(memberFromRow); }); }
  async updateKind(orgId,kind) {
    const k=normalizeKind(kind); if(!k)return{errors:['Tipo de organização inválido.']};
    return this.store.writeDomain(async(c)=>{
      const q=await c.query('UPDATE sceneshop_organizations SET kind=$2,updated_at=now() WHERE id=$1 RETURNING *',[orgId,k]);
      if(!q.rowCount)return{error:'Organização não encontrada.',code:404};
      return{organization:publicOrg(orgFromRow(q.rows[0]))};
    });
  }
  async updateSettings(orgId,patch) {
    return this.store.writeDomain(async(c)=>{
      const current=await c.query('SELECT settings FROM sceneshop_organizations WHERE id=$1 FOR UPDATE',[orgId]); if(!current.rowCount)return{error:'Organização não encontrada.',code:404};
      const old=current.rows[0].settings||{}; const next={...old,...(patch||{}),security:{...(old.security||{}),...(((patch||{}).security)||{})}};
      const q=await c.query('UPDATE sceneshop_organizations SET settings=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *',[orgId,JSON.stringify(next)]);return{organization:publicOrg(orgFromRow(q.rows[0]))};
    });
  }
  async addMember(orgId,username,role,actor) {
    const u=String(username||'').trim().toLowerCase(); const r=normalizeRole(role); if(!r||r==='OWNER') return {errors:['Função organizacional inválida para inclusão.']};
    return this.store.writeDomain(async(c)=>{
      const exists=await c.query('SELECT 1 FROM sceneshop_accounts WHERE username=$1',[u]); if(!exists.rowCount)return{errors:['Usuário não encontrado.']};
      const q=await c.query(`INSERT INTO sceneshop_organization_members(organization_id,username,role,status,invited_by,joined_at) VALUES($1,$2,$3,'ACTIVE',$4,now()) ON CONFLICT(organization_id,username) DO UPDATE SET role=EXCLUDED.role,status='ACTIVE',updated_at=now() RETURNING *`,[orgId,u,r,actor]);
      return {member:memberFromRow(q.rows[0])};
    });
  }
  async setMemberRole(orgId,username,role) {
    const u=String(username||'').toLowerCase(); const r=normalizeRole(role); if(!r)return{errors:['Função organizacional inválida.']};
    return this.store.writeDomain(async(c)=>{
      const current=await c.query('SELECT * FROM sceneshop_organization_members WHERE organization_id=$1 AND username=$2 FOR UPDATE',[orgId,u]); if(!current.rowCount)return{error:'Membro não encontrado.',code:404};
      if(current.rows[0].role==='OWNER'&&r!=='OWNER'){ const owners=await c.query(`SELECT count(*)::int AS n FROM sceneshop_organization_members WHERE organization_id=$1 AND role='OWNER' AND status='ACTIVE'`,[orgId]); if(Number(owners.rows[0].n)<=1)return{errors:['A organização precisa manter ao menos um OWNER ativo.']}; }
      const q=await c.query('UPDATE sceneshop_organization_members SET role=$3,updated_at=now() WHERE organization_id=$1 AND username=$2 RETURNING *',[orgId,u,r]); return{member:memberFromRow(q.rows[0])};
    });
  }
  async removeMember(orgId,username) {
    const u=String(username||'').toLowerCase();
    return this.store.writeDomain(async(c)=>{
      const current=await c.query('SELECT * FROM sceneshop_organization_members WHERE organization_id=$1 AND username=$2 FOR UPDATE',[orgId,u]); if(!current.rowCount)return{error:'Membro não encontrado.',code:404};
      if(current.rows[0].role==='OWNER'){ const owners=await c.query(`SELECT count(*)::int AS n FROM sceneshop_organization_members WHERE organization_id=$1 AND role='OWNER' AND status='ACTIVE'`,[orgId]); if(Number(owners.rows[0].n)<=1)return{errors:['O último OWNER não pode ser removido.']}; }
      await c.query('DELETE FROM sceneshop_organization_members WHERE organization_id=$1 AND username=$2',[orgId,u]); return{ok:true};
    });
  }
  async createInvite(orgId,{username,role,expiresHours=168}={},actor) {
    const u=String(username||'').trim().toLowerCase(); const r=normalizeRole(role);
    if(!r||r==='OWNER')return{errors:['Função organizacional inválida para convite.']};
    return this.store.writeDomain(async(c)=>{
      const account=await c.query('SELECT 1 FROM sceneshop_accounts WHERE username=$1',[u]); if(!account.rowCount)return{errors:['Usuário não encontrado.']};
      const member=await c.query("SELECT 1 FROM sceneshop_organization_members WHERE organization_id=$1 AND username=$2 AND status='ACTIVE'",[orgId,u]); if(member.rowCount)return{errors:['Esse usuário já pertence à organização.']};
      await c.query("UPDATE sceneshop_organization_invites SET status='REVOKED',revoked_at=now() WHERE organization_id=$1 AND username=$2 AND status='PENDING'",[orgId,u]);
      const token=crypto.randomBytes(32).toString('base64url'); const id=crypto.randomUUID();
      const expires=new Date(Date.now()+Math.max(1,Math.min(720,Number(expiresHours)||168))*3600e3);
      const q=await c.query(`INSERT INTO sceneshop_organization_invites(id,organization_id,username,role,token_hash,status,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7) RETURNING *`,[id,orgId,u,r,inviteHash(token),actor,expires]);
      const row=q.rows[0]; return{invite:publicInvite({id:row.id,organizationId:row.organization_id,username:row.username,role:row.role,status:row.status,invitedBy:row.invited_by,expiresAt:millis(row.expires_at),createdAt:millis(row.created_at)}),token};
    });
  }
  async listInvites(orgId) {
    return this.store.writeDomain(async(c)=>{
      await c.query("UPDATE sceneshop_organization_invites SET status='EXPIRED' WHERE organization_id=$1 AND status='PENDING' AND expires_at<=now()",[orgId]);
      const q=await c.query('SELECT * FROM sceneshop_organization_invites WHERE organization_id=$1 ORDER BY created_at DESC',[orgId]);
      return q.rows.map((row)=>publicInvite({id:row.id,organizationId:row.organization_id,username:row.username,role:row.role,status:row.status,invitedBy:row.invited_by,expiresAt:millis(row.expires_at),acceptedAt:millis(row.accepted_at),createdAt:millis(row.created_at)}));
    });
  }
  async revokeInvite(orgId,inviteId) {
    return this.store.writeDomain(async(c)=>{
      const q=await c.query("UPDATE sceneshop_organization_invites SET status='REVOKED',revoked_at=now() WHERE id=$1 AND organization_id=$2 AND status='PENDING' RETURNING *",[inviteId,orgId]);
      if(!q.rowCount)return{error:'Convite não encontrado ou não está pendente.',code:404}; const row=q.rows[0];
      return{invite:publicInvite({id:row.id,organizationId:row.organization_id,username:row.username,role:row.role,status:row.status,invitedBy:row.invited_by,expiresAt:millis(row.expires_at),createdAt:millis(row.created_at)})};
    });
  }
  async acceptInvite(token,username) {
    const hash=inviteHash(token); const u=String(username||'').toLowerCase();
    return this.store.writeDomain(async(c)=>{
      const q=await c.query('SELECT * FROM sceneshop_organization_invites WHERE token_hash=$1 FOR UPDATE',[hash]);
      if(!q.rowCount||q.rows[0].status!=='PENDING')return{error:'Convite inválido ou já utilizado.',code:404}; const row=q.rows[0];
      if(new Date(row.expires_at).getTime()<=Date.now()){await c.query("UPDATE sceneshop_organization_invites SET status='EXPIRED' WHERE id=$1",[row.id]);return{errors:['Convite expirado.']};}
      if(row.username&&row.username!==u)return{error:'Este convite pertence a outro usuário.',code:403};
      const mq=await c.query(`INSERT INTO sceneshop_organization_members(organization_id,username,role,status,invited_by,joined_at) VALUES($1,$2,$3,'ACTIVE',$4,now()) ON CONFLICT(organization_id,username) DO UPDATE SET role=EXCLUDED.role,status='ACTIVE',invited_by=EXCLUDED.invited_by,joined_at=COALESCE(sceneshop_organization_members.joined_at,now()),updated_at=now() RETURNING *`,[row.organization_id,u,row.role,row.invited_by]);
      await c.query("UPDATE sceneshop_organization_invites SET status='ACCEPTED',accepted_at=now(),accepted_by=$2 WHERE id=$1",[row.id,u]);
      return{member:memberFromRow(mq.rows[0]),invite:publicInvite({id:row.id,organizationId:row.organization_id,username:row.username,role:row.role,status:'ACCEPTED',invitedBy:row.invited_by,expiresAt:millis(row.expires_at),acceptedAt:Date.now(),createdAt:millis(row.created_at)})};
    });
  }
}
module.exports={PostgresOrganizationRepository,orgFromRow,memberFromRow};
