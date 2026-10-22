/**
 * Rotas das contas de clientes (rcprep.16).
 *
 * Console do SceneShop (operador da plataforma: conta com platformAdmin — tools/criar-admin.js — ou moderador):
 *   GET  /api/admin/clients?from&to                 todos os clientes com totais do período
 *   GET  /api/admin/clients/:orgId?from&to          contrato + relatório por título e por produto
 *   PUT  /api/admin/clients/:orgId/contract         grava o contrato (nova versão)
 *   GET  /api/admin/clients/:orgId/report.csv       relatório em CSV (Excel)
 * Cliente (membros da organização com ANALYTICS_READ):
 *   GET  /api/me/account-report?from&to             o mesmo relatório, só da própria organização
 *   GET  /api/me/account-report.csv
 */
const express = require("express");
const accounts = require("./client-accounts");
const audit = require("./audit");
const orgAccess = require("./organizations");
const { content, organizations } = require("./repositories");

const DAY = 864e5;

function period(q) {
  const parse = (v, endOfDay) => {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return Date.parse(`${v}T00:00:00Z`) + (endOfDay ? DAY : 0);
    const n = Number(v); return Number.isFinite(n) ? n : null;
  };
  let from = parse(q.from, false), to = parse(q.to, true);
  if (!from && !to && q.days) { to = Date.now(); from = to - Math.min(3650, Math.max(1, Number(q.days) || 30)) * DAY; }
  return { from, to };
}

async function worksOf(orgId) {
  // inclui títulos excluídos: as vendas antigas continuam no relatório
  const live = (await Promise.resolve(content.listWorksByOrganizationAuthoritative(orgId))) || [];
  const all = (await Promise.resolve(content.listWorksAuthoritative())) || [];
  const map = new Map(live.map((w) => [w.id, w]));
  for (const w of all) if (accounts.workOrganization(w.id) === orgId && !map.has(w.id)) map.set(w.id, w);
  return [...map.values()];
}

async function productsOf(orgId) {
  return ((await Promise.resolve(content.listProductsByOrganizationAuthoritative(orgId))) || []).filter((p) => !p.archivedAt);
}

async function fullReport(orgId, q) {
  const [works, products] = await Promise.all([worksOf(orgId), productsOf(orgId)]);
  const names = new Map(products.map((p) => [p.id, p.name]));
  const rep = accounts.report(orgId, { ...period(q), works, productName: (id) => names.get(id) });
  return { rep, works, products };
}

// contrato como o cliente vê (sem notas internas nem histórico)
function clientView(c) {
  if (!c) return null;
  const strip = (l) => { const { notes, ...rest } = l || {}; return rest; };
  return { status: c.status, currency: c.currency, contractRef: c.contractRef, startsAt: c.startsAt, endsAt: c.endsAt, monthlyFee: c.monthlyFee, version: c.version,
    terms: strip(c.terms), works: Object.fromEntries(Object.entries(c.works || {}).map(([k, v]) => [k, strip(v)])), products: Object.fromEntries(Object.entries(c.products || {}).map(([k, v]) => [k, strip(v)])) };
}

module.exports = function clientAccountRoutes({ requireRole, actor }) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const operator = (req, res, next) => {
    if (!req.user || !(req.user.platformAdmin || req.user.role === "moderator")) return res.status(403).json({ error: "Somente a equipe SceneShop acessa as contas de clientes." });
    next();
  };
  const orgOr404 = async (req, res) => {
    const org = await Promise.resolve(organizations.get(req.params.orgId));
    if (!org) { res.status(404).json({ error: "Cliente não encontrado." }); return null; }
    return org;
  };

  r.get("/api/admin/clients", requireRole(), operator, wrap(async (req, res) => {
    const orgs = (await Promise.resolve(organizations.listAll())) || [];
    const rows = [];
    for (const org of orgs) {
      const works = await worksOf(org.id);
      const rep = accounts.report(org.id, { ...period(req.query), works });
      const c = accounts.get(org.id);
      rows.push({ id: org.id, name: org.name, kind: org.kind, status: org.status, works: works.filter((w) => !w.archivedAt).length,
        contract: c ? { status: c.status, version: c.version, contractRef: c.contractRef } : null, totals: rep.totals });
    }
    rows.sort((a, b) => b.totals.gmv - a.totals.gmv || b.totals.clicks - a.totals.clicks || a.name.localeCompare(b.name));
    const sum = (k) => Math.round(rows.reduce((n, x) => n + Number(x.totals[k] || 0), 0) * 100) / 100;
    res.json({ clients: rows, totals: { clients: rows.length, clicks: sum("clicks"), orders: sum("orders"), gmv: sum("gmv"), commission: sum("commission"), clientShare: sum("clientShare"), sceneshopRevenue: sum("sceneshopRevenue") } });
  }));

  r.get("/api/admin/clients/:orgId", requireRole(), operator, wrap(async (req, res) => {
    const org = await orgOr404(req, res); if (!org) return;
    const { rep, works, products } = await fullReport(org.id, req.query);
    res.json({ organization: { id: org.id, name: org.name, kind: org.kind, status: org.status }, contract: accounts.get(org.id), report: rep,
      works: works.map((w) => ({ id: w.id, title: w.title, archived: !!w.archivedAt })), products: products.map((p) => ({ id: p.id, name: p.name, brand: p.brand || "" })) });
  }));

  r.put("/api/admin/clients/:orgId/contract", requireRole(), operator, wrap(async (req, res) => {
    const org = await orgOr404(req, res); if (!org) return;
    const out = accounts.save(org.id, req.body || {}, actor(req));
    if (out.error) return res.status(out.code || 400).json(out);
    audit.log(actor(req), "contrato_cliente_salvo", { organizationId: org.id, version: out.contract.version, terms: out.contract.terms, works: Object.keys(out.contract.works).length, products: Object.keys(out.contract.products).length });
    res.json(out);
  }));

  r.get("/api/admin/clients/:orgId/report.csv", requireRole(), operator, wrap(async (req, res) => {
    const org = await orgOr404(req, res); if (!org) return;
    const { rep } = await fullReport(org.id, req.query);
    res.type("text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="sceneshop-${org.id}.csv"`).send(accounts.toCsv(rep, org.name));
  }));

  // ---------------------------------------------------------------- visão do próprio cliente
  r.get("/api/me/account-report", requireRole(), orgAccess.requireCapability("ANALYTICS_READ"), wrap(async (req, res) => {
    const { rep } = await fullReport(req.organization.id, req.query);
    res.json({ organization: { id: req.organization.id, name: req.organization.name }, contract: clientView(accounts.get(req.organization.id)), report: rep });
  }));
  r.get("/api/me/account-report.csv", requireRole(), orgAccess.requireCapability("ANALYTICS_READ"), wrap(async (req, res) => {
    const { rep } = await fullReport(req.organization.id, req.query);
    res.type("text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="sceneshop-relatorio.csv"`).send(accounts.toCsv(rep, req.organization.name));
  }));

  return r;
};
