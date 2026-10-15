const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { StateOrganizationRepository, normalizeSlug } = require('../server/repositories/organization');

function fixture() {
  const state = {
    accounts: { alice:{username:'alice'}, bob:{username:'bob'}, carol:{username:'carol'} },
    organizations:{}, organizationMembers:{}, organizationInvites:{},
  };
  let saves=0;
  return { state, repo:new StateOrganizationRepository(()=>state,()=>{saves+=1;}), saves:()=>saves };
}

test('organization: criação torna o criador OWNER e normaliza slug', () => {
  const f=fixture();
  const r=f.repo.create({name:'Canal São João',kind:'CHANNEL'},'alice');
  assert.ok(r.organization.id.startsWith('org-'));
  assert.equal(r.organization.slug,'canal-sao-joao');
  assert.equal(r.organization.membership.role,'OWNER');
  assert.equal(f.repo.getMembership(r.organization.id,'alice').role,'OWNER');
  assert.equal(f.repo.listForUser('alice').length,1);
  assert.ok(f.saves()>0);
});

test('organization: usuário pode ter funções diferentes em organizações diferentes', () => {
  const f=fixture();
  const a=f.repo.create({name:'Produtora A',kind:'PRODUCER'},'alice').organization;
  const b=f.repo.create({name:'Canal B',kind:'CHANNEL'},'bob').organization;
  assert.equal(f.repo.addMember(a.id,'carol','COMMERCIAL','alice').member.role,'COMMERCIAL');
  assert.equal(f.repo.addMember(b.id,'carol','EDITOR','bob').member.role,'EDITOR');
  const roles=Object.fromEntries(f.repo.listForUser('carol').map((o)=>[o.id,o.membership.role]));
  assert.equal(roles[a.id],'COMMERCIAL');
  assert.equal(roles[b.id],'EDITOR');
});

test('organization: último OWNER não pode ser removido nem rebaixado', () => {
  const f=fixture();
  const org=f.repo.create({name:'Produtora',kind:'PRODUCER'},'alice').organization;
  assert.ok(f.repo.setMemberRole(org.id,'alice','ADMIN').errors);
  assert.ok(f.repo.removeMember(org.id,'alice').errors);
  f.repo.addMember(org.id,'bob','ADMIN','alice');
  assert.equal(f.repo.setMemberRole(org.id,'bob','OWNER').member.role,'OWNER');
  assert.equal(f.repo.setMemberRole(org.id,'alice','ADMIN').member.role,'ADMIN');
});

test('organization: slug duplicado é recusado', () => {
  const f=fixture();
  f.repo.create({name:'Grupo Aurora',slug:'aurora',kind:'CONTENT_OWNER'},'alice');
  const second=f.repo.create({name:'Outra',slug:'aurora',kind:'BRAND'},'bob');
  assert.ok(second.errors);
  assert.equal(normalizeSlug('  Árvore & Mídia  '),'arvore-midia');
});

test('organization: migration PostgreSQL fixa isolamento e papéis de tenant', () => {
  const sql=fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0012_multi_tenant_foundation.sql'),'utf8');
  assert.match(sql,/sceneshop_organizations/);
  assert.match(sql,/sceneshop_organization_members/);
  assert.match(sql,/OWNER.*ADMIN.*EDITOR.*COMMERCIAL.*ANALYST.*VIEWER/s);
  assert.match(sql,/PRIMARY KEY \(organization_id, username\)/);
});
