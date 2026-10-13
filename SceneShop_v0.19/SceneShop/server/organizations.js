const { organizations } = require('./repositories');
const { ADMIN_ROLES } = require('./repositories/organization');

const isPromise = (v) => !!v && typeof v.then === 'function';

const CAPABILITIES = Object.freeze({
  OWNER: new Set(['ORG_READ','ORG_SETTINGS','MEMBERS_READ','MEMBERS_MANAGE','CONTENT_READ','CONTENT_WRITE','AI_RUN','COMMERCE_READ','COMMERCE_WRITE','ANALYTICS_READ']),
  ADMIN: new Set(['ORG_READ','ORG_SETTINGS','MEMBERS_READ','MEMBERS_MANAGE','CONTENT_READ','CONTENT_WRITE','AI_RUN','COMMERCE_READ','COMMERCE_WRITE','ANALYTICS_READ']),
  EDITOR: new Set(['ORG_READ','MEMBERS_READ','CONTENT_READ','CONTENT_WRITE','AI_RUN','COMMERCE_READ','ANALYTICS_READ']),
  COMMERCIAL: new Set(['ORG_READ','MEMBERS_READ','CONTENT_READ','COMMERCE_READ','COMMERCE_WRITE','ANALYTICS_READ']),
  ANALYST: new Set(['ORG_READ','MEMBERS_READ','CONTENT_READ','COMMERCE_READ','ANALYTICS_READ']),
  VIEWER: new Set(['ORG_READ','CONTENT_READ','COMMERCE_READ']),
});

async function attach(req, res, next) {
  if (!req.user) { req.organization=null; req.orgMembership=null; return next(); }
  let orgId = String(req.headers['x-sceneshop-organization'] || '').trim();
  try {
    if (!orgId) {
      const available = await Promise.resolve(organizations.listForUser(req.user.username));
      if (available.length === 1) orgId = available[0].id;
      else { req.organization=null; req.orgMembership=null; return next(); }
    }
    const result = organizations.getMembership(orgId, req.user.username);
    const done = async (membership) => {
      if (!membership || membership.status !== 'ACTIVE') { req.organization=null; req.orgMembership=null; return next(); }
      const org = await Promise.resolve(organizations.get(orgId));
      if (!org || org.status !== 'ACTIVE') { req.organization=null; req.orgMembership=null; return next(); }
      req.organization=org; req.orgMembership=membership; return next();
    };
    return isPromise(result) ? result.then(done).catch(next) : done(result);
  } catch (err) { return next(err); }
}

function hasCapability(membership, capability) {
  if (!membership || membership.status !== 'ACTIVE') return false;
  return !!(CAPABILITIES[membership.role] && CAPABILITIES[membership.role].has(String(capability || '').toUpperCase()));
}

function organizationRequiresMfa(org) {
  const security = org && org.settings && org.settings.security;
  return !!(security && security.requireMfaForWrites);
}

function requireCapability(capability, { strong = false } = {}) {
  const cap = String(capability || '').toUpperCase();
  return (req,res,next) => {
    if (!req.user) return res.status(401).json({error:'Entre na sua conta.'});
    if (!req.organization || !req.orgMembership) return res.status(400).json({error:'Selecione uma organização válida em X-SceneShop-Organization.'});
    if (!hasCapability(req.orgMembership, cap)) return res.status(403).json({error:'Sem permissão nesta organização.', capability:cap});
    const needsMfa = strong || (organizationRequiresMfa(req.organization) && /(_WRITE|_MANAGE|_SETTINGS|AI_RUN)$/.test(cap));
    if (needsMfa && !(req.user._auth && req.user._auth.mfa)) return res.status(403).json({error:'MFA_REQUIRED', message:'Esta ação exige autenticação multifator.'});
    next();
  };
}

function requireAnyCapability(...capabilities) {
  const caps=capabilities.flat().map((x)=>String(x||'').toUpperCase());
  return (req,res,next)=>{
    if(!req.user)return res.status(401).json({error:'Entre na sua conta.'});
    if(!req.organization||!req.orgMembership)return res.status(400).json({error:'Selecione uma organização válida em X-SceneShop-Organization.'});
    if(!caps.some((cap)=>hasCapability(req.orgMembership,cap)))return res.status(403).json({error:'Sem permissão nesta organização.',capabilities:caps});
    const requiresWrite=caps.some((cap)=>hasCapability(req.orgMembership,cap)&&/(_WRITE|_MANAGE|_SETTINGS|AI_RUN)$/.test(cap));
    if(requiresWrite&&organizationRequiresMfa(req.organization)&&!(req.user._auth&&req.user._auth.mfa))return res.status(403).json({error:'MFA_REQUIRED',message:'Esta ação exige autenticação multifator.'});
    next();
  };
}

function requireOrganization(...roles) {
  const wanted = roles.map((x)=>String(x).toUpperCase());
  return (req,res,next) => {
    if (!req.user) return res.status(401).json({error:'Entre na sua conta.'});
    if (!req.organization || !req.orgMembership) return res.status(400).json({error:'Selecione uma organização válida em X-SceneShop-Organization.'});
    if (wanted.length && !wanted.includes(req.orgMembership.role)) return res.status(403).json({error:'Sem permissão nesta organização.'});
    next();
  };
}

function canAdmin(membership) { return !!membership && membership.status === 'ACTIVE' && ADMIN_ROLES.has(membership.role); }
function canManageRole(actorRole, targetRole) {
  if (actorRole === 'OWNER') return true;
  if (actorRole !== 'ADMIN') return false;
  return !['OWNER','ADMIN'].includes(String(targetRole || '').toUpperCase());
}

module.exports = { attach, requireOrganization, requireCapability, requireAnyCapability, hasCapability, CAPABILITIES, organizationRequiresMfa, canAdmin, canManageRole };
