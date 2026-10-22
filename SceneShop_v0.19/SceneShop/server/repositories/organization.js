const crypto = require('crypto');

const ORG_KINDS = new Set(['CONTENT_OWNER','PRODUCER','CHANNEL','BRAND','AGENCY','PLATFORM','RETAILER','OTHER']);
const ORG_ROLES = new Set(['OWNER','ADMIN','EDITOR','COMMERCIAL','ANALYST','VIEWER']);
const MEMBER_STATUSES = new Set(['ACTIVE','INVITED','SUSPENDED']);
const ADMIN_ROLES = new Set(['OWNER','ADMIN']);

function normalizeSlug(v) {
  return String(v || '').trim().toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
function normalizeKind(v) {
  const kind = String(v || 'OTHER').trim().toUpperCase();
  return ORG_KINDS.has(kind) ? kind : null;
}
function normalizeRole(v) {
  const role = String(v || '').trim().toUpperCase();
  return ORG_ROLES.has(role) ? role : null;
}

function publicInvite(invite) {
  if (!invite) return null;
  return {
    id: invite.id, organizationId: invite.organizationId, username: invite.username || null,
    role: invite.role, status: invite.status, invitedBy: invite.invitedBy || null,
    expiresAt: invite.expiresAt || null, acceptedAt: invite.acceptedAt || null, createdAt: invite.createdAt || null,
  };
}
function inviteHash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }

function publicOrg(org, membership = null) {
  if (!org) return null;
  return {
    id: org.id, slug: org.slug, name: org.name, kind: org.kind, status: org.status || 'ACTIVE',
    settings: org.settings || {}, createdAt: org.createdAt || null,
    membership: membership ? { role: membership.role, status: membership.status } : undefined,
  };
}

class StateOrganizationRepository {
  constructor(getState, save = () => {}) {
    this.getState = getState;
    this.save = save;
  }
  state() {
    const s = this.getState();
    s.organizations ||= {};
    s.organizationMembers ||= {};
    s.organizationInvites ||= {};
    return s;
  }
  listForUser(username) {
    const s = this.state();
    const u = String(username || '').toLowerCase();
    return Object.values(s.organizationMembers)
      .filter((m) => m.username === u && m.status === 'ACTIVE')
      .map((m) => publicOrg(s.organizations[m.organizationId], m))
      .filter(Boolean)
      .sort((a,b) => a.name.localeCompare(b.name));
  }
  get(orgId) { return this.state().organizations[String(orgId || '')] || null; }
  // todas as organizações (console de clientes do SceneShop)
  listAll() { return Object.values(this.state().organizations).filter(Boolean).sort((a,b) => String(a.name||'').localeCompare(String(b.name||''))); }
  getMembership(orgId, username) {
    return this.state().organizationMembers[`${orgId}:${String(username || '').toLowerCase()}`] || null;
  }
  create({ name, slug, kind='OTHER', settings={} }, actor) {
    const s = this.state();
    const cleanName = String(name || '').trim().slice(0, 120);
    const cleanSlug = normalizeSlug(slug || cleanName);
    const cleanKind = normalizeKind(kind);
    if (cleanName.length < 2) return { errors:['Nome da organização é obrigatório.'] };
    if (cleanSlug.length < 2) return { errors:['Slug da organização é inválido.'] };
    if (!cleanKind) return { errors:['Tipo de organização inválido.'] };
    if (Object.values(s.organizations).some((o) => o.slug === cleanSlug)) return { errors:['Esse identificador de organização já existe.'] };
    const id = `org-${crypto.randomUUID()}`;
    const at = Date.now();
    const org = { id, slug:cleanSlug, name:cleanName, kind:cleanKind, status:'ACTIVE', settings, createdBy:actor, createdAt:at, updatedAt:at };
    const member = { organizationId:id, username:String(actor).toLowerCase(), role:'OWNER', status:'ACTIVE', joinedAt:at, createdAt:at, updatedAt:at };
    s.organizations[id] = org;
    s.organizationMembers[`${id}:${member.username}`] = member;
    this.save();
    return { organization:publicOrg(org, member) };
  }
  listMembers(orgId) {
    return Object.values(this.state().organizationMembers)
      .filter((m) => m.organizationId === orgId)
      .sort((a,b) => a.username.localeCompare(b.username));
  }
  updateKind(orgId, kind) {
    const org=this.get(orgId); if(!org)return{error:'Organização não encontrada.',code:404};
    const k=normalizeKind(kind); if(!k)return{errors:['Tipo de organização inválido.']};
    org.kind=k; org.updatedAt=Date.now(); this.save(); return{organization:publicOrg(org)};
  }
  updateSettings(orgId, patch) {
    const org=this.get(orgId); if(!org)return{error:'Organização não encontrada.',code:404};
    org.settings={...(org.settings||{}),...(patch||{}),security:{...((org.settings||{}).security||{}),...(((patch||{}).security)||{})}}; org.updatedAt=Date.now(); this.save(); return{organization:publicOrg(org)};
  }
  addMember(orgId, username, role, actor) {
    const s = this.state();
    const org = s.organizations[orgId];
    if (!org) return { error:'Organização não encontrada.', code:404 };
    const u = String(username || '').trim().toLowerCase();
    const r = normalizeRole(role);
    if (!u || !s.accounts[u]) return { errors:['Usuário não encontrado.'] };
    if (!r || r === 'OWNER') return { errors:['Função organizacional inválida para inclusão.'] };
    const at = Date.now();
    const member = { organizationId:orgId, username:u, role:r, status:'ACTIVE', invitedBy:actor, joinedAt:at, createdAt:at, updatedAt:at };
    s.organizationMembers[`${orgId}:${u}`] = member;
    this.save();
    return { member };
  }
  setMemberRole(orgId, username, role) {
    const s = this.state(); const key=`${orgId}:${String(username || '').toLowerCase()}`; const m=s.organizationMembers[key];
    if (!m) return { error:'Membro não encontrado.', code:404 };
    const r=normalizeRole(role); if (!r) return { errors:['Função organizacional inválida.'] };
    if (m.role === 'OWNER' && r !== 'OWNER') {
      const owners=this.listMembers(orgId).filter((x)=>x.status==='ACTIVE'&&x.role==='OWNER');
      if (owners.length <= 1) return { errors:['A organização precisa manter ao menos um OWNER ativo.'] };
    }
    m.role=r; m.updatedAt=Date.now(); this.save(); return { member:m };
  }
  removeMember(orgId, username) {
    const s=this.state(); const key=`${orgId}:${String(username || '').toLowerCase()}`; const m=s.organizationMembers[key];
    if (!m) return { error:'Membro não encontrado.', code:404 };
    if (m.role==='OWNER') {
      const owners=this.listMembers(orgId).filter((x)=>x.status==='ACTIVE'&&x.role==='OWNER');
      if (owners.length<=1) return { errors:['O último OWNER não pode ser removido.'] };
    }
    delete s.organizationMembers[key]; this.save(); return { ok:true };
  }
  createInvite(orgId, { username, role, expiresHours = 168 } = {}, actor) {
    const s=this.state();
    if (!s.organizations[orgId]) return { error:'Organização não encontrada.', code:404 };
    const u=String(username||'').trim().toLowerCase(); const r=normalizeRole(role);
    if (!u || !s.accounts[u]) return { errors:['Usuário não encontrado.'] };
    if (!r || r==='OWNER') return { errors:['Função organizacional inválida para convite.'] };
    const existing=this.getMembership(orgId,u);
    if (existing && existing.status==='ACTIVE') return { errors:['Esse usuário já pertence à organização.'] };
    Object.values(s.organizationInvites).forEach((i)=>{ if(i.organizationId===orgId&&i.username===u&&i.status==='PENDING') i.status='REVOKED'; });
    const token=crypto.randomBytes(32).toString('base64url'); const now=Date.now();
    const invite={ id:crypto.randomUUID(), organizationId:orgId, username:u, role:r, tokenHash:inviteHash(token), status:'PENDING', invitedBy:actor, expiresAt:now+Math.max(1,Math.min(720,Number(expiresHours)||168))*3600e3, createdAt:now };
    s.organizationInvites[invite.id]=invite; this.save();
    return { invite:publicInvite(invite), token };
  }
  listInvites(orgId) {
    const now=Date.now(); const s=this.state(); let changed=false;
    Object.values(s.organizationInvites).forEach((i)=>{ if(i.organizationId===orgId&&i.status==='PENDING'&&i.expiresAt<=now){i.status='EXPIRED';changed=true;} });
    if(changed)this.save();
    return Object.values(s.organizationInvites).filter((i)=>i.organizationId===orgId).map(publicInvite).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  }
  revokeInvite(orgId, inviteId) {
    const i=this.state().organizationInvites[inviteId]; if(!i||i.organizationId!==orgId)return{error:'Convite não encontrado.',code:404};
    if(i.status!=='PENDING')return{errors:['Somente convites pendentes podem ser revogados.']}; i.status='REVOKED'; i.revokedAt=Date.now(); this.save(); return{invite:publicInvite(i)};
  }
  acceptInvite(token, username) {
    const s=this.state(); const hash=inviteHash(token); const u=String(username||'').toLowerCase(); const now=Date.now();
    const i=Object.values(s.organizationInvites).find((x)=>x.tokenHash===hash);
    if(!i||i.status!=='PENDING')return{error:'Convite inválido ou já utilizado.',code:404};
    if(i.expiresAt<=now){i.status='EXPIRED';this.save();return{errors:['Convite expirado.']};}
    if(i.username&&i.username!==u)return{error:'Este convite pertence a outro usuário.',code:403};
    const member={organizationId:i.organizationId,username:u,role:i.role,status:'ACTIVE',invitedBy:i.invitedBy,joinedAt:now,createdAt:now,updatedAt:now};
    s.organizationMembers[`${i.organizationId}:${u}`]=member; i.status='ACCEPTED';i.acceptedAt=now;i.acceptedBy=u;this.save();
    return{member,invite:publicInvite(i)};
  }
}

module.exports = { StateOrganizationRepository, normalizeSlug, normalizeKind, normalizeRole, publicOrg, publicInvite, inviteHash, ORG_KINDS, ORG_ROLES, MEMBER_STATUSES, ADMIN_ROLES };
