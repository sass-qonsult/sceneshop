const test = require("node:test");
const assert = require("node:assert/strict");
const { StateIdentityRepository } = require("../server/repositories/identity");

test("identity repository normaliza username e cria conta+autor juntos", () => {
  const state = { accounts: {}, authors: {} };
  const repo = new StateIdentityRepository(() => state);
  const r = repo.createIdentity({
    account: { username: "  Alice  ", role: "author", tokenVersion: 1 },
    author: { id: "alice", name: "Alice" },
  });
  assert.equal(r.account.username, "alice");
  assert.equal(repo.findAccount("ALICE"), r.account);
  assert.equal(repo.findAuthor("alice"), r.author);
  assert.equal(repo.existsUsername("Alice"), true);
});

test("identity repository rejeita username duplicado", () => {
  const state = { accounts: { alice: { username: "alice" } }, authors: {} };
  const repo = new StateIdentityRepository(() => state);
  assert.throws(() => repo.createIdentity({
    account: { username: "alice" }, author: { id: "alice" },
  }), /já existe/);
});

test("identity repository incrementa tokenVersion", () => {
  const state = { accounts: { alice: { username: "alice", tokenVersion: 4 } }, authors: {} };
  const repo = new StateIdentityRepository(() => state);
  assert.equal(repo.incrementTokenVersion("ALICE").tokenVersion, 5);
});
