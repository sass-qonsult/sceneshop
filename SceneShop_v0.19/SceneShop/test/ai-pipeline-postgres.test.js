// Regressão do pipeline de IA no PostgreSQL: aprovar uma identificação cria o placement e o
// workspace de IA do Studio lista os placements da obra. Antes da correção as duas consultas
// usavam sceneshop_placements.organization_id, coluna que não existe, e o Studio mostrava
// "Falha ao carregar o workspace de IA".
// Roda só com TEST_DATABASE_URL apontando para um banco vazio de testes; sem ela, é pulado.
const test = require("node:test");
const assert = require("node:assert/strict");

const url = process.env.TEST_DATABASE_URL;

test("pipeline de IA no PostgreSQL: aprovação cria placement e o workspace lista", { skip: !url && "TEST_DATABASE_URL não definido" }, async () => {
  const { PostgresStateRepository } = require("../server/data/postgres-state");
  const { PostgresAiPipelineRepository } = require("../server/repositories/ai-pipeline-postgres");
  const store = new PostgresStateRepository({ connectionString: url });
  await store.init();
  try {
    const org = "org-pg-ai-test", other = "org-pg-ai-other", workId = "work-pg-ai-test";
    for (const id of [org, other]) {
      await store.pool.query(
        `INSERT INTO sceneshop_organizations(id,slug,name,kind) VALUES($1,$1,$1,'PRODUCER') ON CONFLICT (id) DO NOTHING`, [id]);
    }
    await store.pool.query(
      `INSERT INTO sceneshop_works(id,title,video_url,organization_id) VALUES($1,'Teste IA PG','/uploads/videos/teste.mp4',$2) ON CONFLICT (id) DO UPDATE SET organization_id=EXCLUDED.organization_id`,
      [workId, org]
    );
    const ai = new PostgresAiPipelineRepository({ store });
    const asset = await ai.createAsset(org, { name: "Jaqueta de couro", brand: "Urbano", category: "APPAREL" }, "tester");
    assert.ok(asset.asset, JSON.stringify(asset));
    const job = await ai.createJob(org, { id: workId }, { mode: "TARGETED", scanDepth: "STANDARD", assetIds: [asset.asset.id] }, "tester");
    assert.ok(job.job, JSON.stringify(job));
    await ai.startJob(org, job.job.id);
    const cand = await ai.recordPrimaryCandidate(org, job.job.id, { assetId: asset.asset.id, name: "Jaqueta", startSeconds: 5, endSeconds: 9, confidence: 0.9 });
    assert.ok(cand.candidate, JSON.stringify(cand));

    const reviewed = await ai.reviewCandidate(org, cand.candidate.id, { decision: "APPROVE" }, "tester");
    assert.ok(reviewed.placement, JSON.stringify(reviewed));
    assert.equal(reviewed.placement.organizationId, org);
    assert.equal(reviewed.placement.workId, workId);

    const placements = await ai.listPlacements(org, workId);
    assert.equal(placements.length, 1);
    assert.equal(placements[0].id, reviewed.placement.id);
    assert.equal(placements[0].organizationId, org);
    assert.equal((await ai.listPlacements(org)).length >= 1, true);
    assert.equal((await ai.listPlacements(other, workId)).length, 0, "outra organização não vê o placement");
  } finally {
    await store.close();
  }
});
