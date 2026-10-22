/**
 * Produtos por projeto (obra). Cada produto da organização fica ligado às obras em que foi
 * cadastrado ou usado (product.workIds); a aba Produtos e o Editor mostram os produtos do projeto
 * aberto, e um produto de outro projeto entra por "Puxar de outro projeto".
 * Produtos antigos sem workIds ganham os projetos das trilhas em que aparecem.
 */
const { content } = require("./repositories");

// produto -> projetos (gravados + trilhas ativas da organização em que ele aparece), só obras não excluídas
async function projectsByProduct(organizationId) {
  const live = new Set(((await Promise.resolve(content.listWorksByOrganizationAuthoritative(organizationId))) || []).map((w) => w.id));
  const map = new Map();
  const add = (pid, wid) => { if (!live.has(wid)) return; if (!map.has(pid)) map.set(pid, new Set()); map.get(pid).add(wid); };
  for (const t of (await Promise.resolve(content.listTracksByOrganizationAuthoritative(organizationId, null))) || []) {
    if (!t || t.status === "removida") continue;
    for (const s of t.scenes || []) for (const p of s.products || []) add(p.id, t.workId);
  }
  return { map, add, live };
}

async function withProjects(organizationId, products) {
  const { map, add } = await projectsByProduct(organizationId);
  for (const p of products || []) for (const w of p.workIds || []) add(p.id, w);
  return (products || []).map((p) => ({ ...p, projects: [...(map.get(p.id) || [])] }));
}

// liga produtos a um projeto (gravando workIds); usado ao salvar trilhas e ao puxar de outro projeto
async function linkProducts(organizationId, workId, productIds) {
  let linked = 0;
  for (const id of new Set(productIds || [])) {
    const p = await Promise.resolve(content.getProductForOrganizationAuthoritative(id, organizationId, { allowGlobal: false }));
    if (!p || p.archivedAt || (p.workIds || []).includes(workId)) continue;
    await content.updateProductAuthoritative({ ...p, workIds: [...(p.workIds || []), workId] });
    linked++;
  }
  return linked;
}

async function unlinkProduct(organizationId, workId, productId) {
  const p = await Promise.resolve(content.getProductForOrganizationAuthoritative(productId, organizationId, { allowGlobal: false }));
  if (!p || p.archivedAt) return { error: "Produto não encontrado nesta organização.", code: 404 };
  const used = ((await Promise.resolve(content.listTracksByOrganizationAuthoritative(organizationId, workId))) || [])
    .find((t) => t.status !== "removida" && (t.scenes || []).some((s) => (s.products || []).some((x) => x.id === productId)));
  if (used) return { error: `O produto está na trilha "${used.title}" deste projeto. Tire-o das cenas antes.`, code: 409 };
  const updated = await content.updateProductAuthoritative({ ...p, workIds: (p.workIds || []).filter((w) => w !== workId) });
  return { ok: true, product: updated };
}

module.exports = { projectsByProduct, withProjects, linkProducts, unlinkProduct };
