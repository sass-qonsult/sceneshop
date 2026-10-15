const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { StateOrganizationRepository } = require('../server/repositories/organization');
const orgAccess = require('../server/organizations');
const mfa = require('../server/security/mfa');

test('RBAC: capability matrix separates editorial, commercial and analytics duties', () => {
  const active = (role) => ({ role, status:'ACTIVE' });
  assert.equal(orgAccess.hasCapability(active('EDITOR'),'CONTENT_WRITE'), true);
  assert.equal(orgAccess.hasCapability(active('EDITOR'),'COMMERCE_WRITE'), false);
  assert.equal(orgAccess.hasCapability(active('COMMERCIAL'),'COMMERCE_WRITE'), true);
  assert.equal(orgAccess.hasCapability(active('COMMERCIAL'),'AI_RUN'), false);
  assert.equal(orgAccess.hasCapability(active('ANALYST'),'ANALYTICS_READ'), true);
  assert.equal(orgAccess.hasCapability(active('VIEWER'),'CONTENT_WRITE'), false);
});

test('invites: token is one-time, hashed at rest and bound to invited username', () => {
  const state={accounts:{alice:{username:'alice'},bob:{username:'bob'},carol:{username:'carol'}},organizations:{},organizationMembers:{},organizationInvites:{}};
  const repo=new StateOrganizationRepository(()=>state,()=>{});
  const org=repo.create({name:'Studio Aurora',kind:'PRODUCER'},'alice').organization;
  const created=repo.createInvite(org.id,{username:'bob',role:'EDITOR',expiresHours:24},'alice');
  assert.ok(created.token);
  const stored=Object.values(state.organizationInvites)[0];
  assert.ok(stored.tokenHash);
  assert.equal(JSON.stringify(stored).includes(created.token),false);
  assert.equal(repo.acceptInvite(created.token,'carol').code,403);
  const accepted=repo.acceptInvite(created.token,'bob');
  assert.equal(accepted.member.role,'EDITOR');
  assert.equal(repo.acceptInvite(created.token,'bob').code,404);
});

test('MFA: AES-GCM protects secret and TOTP verifies only within configured window', () => {
  const master='this-is-a-test-master-secret-with-more-than-32-chars';
  const secret=mfa.generateSecret();
  const encrypted=mfa.encryptSecret(secret,master);
  assert.notEqual(encrypted.ciphertext,secret);
  assert.equal(mfa.decryptSecret(encrypted,master),secret);
  const at=Date.UTC(2026,9,3,12,0,0);
  const code=mfa.totp(secret,at);
  assert.equal(mfa.verifyTotp(code,secret,{at,window:0}),true);
  assert.equal(mfa.verifyTotp(code,secret,{at:at+90000,window:0}),false);
});

test('MFA: RFC 6238 SHA1 vector is compatible with HOTP/TOTP core', () => {
  // RFC 6238 shared secret: ASCII "12345678901234567890" -> Base32
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(mfa.hotp(secret,1,8),'94287082');
});

test('security migration adds MFA, session strength and hardened invitation fields', () => {
  const sql=fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0014_rbac_invites_mfa.sql'),'utf8');
  assert.match(sql,/sceneshop_account_mfa/);
  assert.match(sql,/auth_strength/);
  assert.match(sql,/accepted_by/);
  assert.match(sql,/revoked_at/);
  const foundation=fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0012_multi_tenant_foundation.sql'),'utf8');
  assert.match(foundation,/token_hash/);
});
