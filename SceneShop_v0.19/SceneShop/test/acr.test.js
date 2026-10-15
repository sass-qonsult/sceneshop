// Reconhecimento por áudio com a ACRCloud: assinatura, leitura da resposta, cadastro e identificação
// contra o simulador (test/acrcloud-mock.mjs), sem rede externa.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

process.env.SCENESHOP_MEMORY = "1";
const acr = require("../server/acr");
const uploads = require("../server/uploads");

function wav(seconds, silent = false) {
  const n = 8000 * seconds, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  if (!silent) for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 7)), 44 + i * 2);
  return b;
}

test("assinatura segue o formato da ACRCloud (HMAC-SHA1 em base64 de 6 campos)", () => {
  const expected = crypto.createHmac("sha1", "segredo").update("POST\n/v1/identify\nchave\naudio\n1\n1700000000").digest("base64");
  assert.equal(acr.sign({ accessKey: "chave", accessSecret: "segredo", timestamp: 1700000000 }), expected);
  assert.equal(acr.identifyUrl("identify-eu-west-1.acrcloud.com"), "https://identify-eu-west-1.acrcloud.com/v1/identify");
  assert.equal(acr.identifyUrl("http://127.0.0.1:3997/"), "http://127.0.0.1:3997/v1/identify");
  assert.equal(acr.consoleFromHost("identify-eu-west-1.acrcloud.com"), "https://api-eu-west-1.acrcloud.com");
  assert.equal(acr.consoleFromHost("https://identify-ap-southeast-1.acrcloud.com"), "https://api-ap-southeast-1.acrcloud.com");
  assert.equal(acr.consoleFromHost("outro.exemplo.com"), "https://api-v2.acrcloud.com");
});

test("resposta: obra pelo user_defined, posição em segundos, maior nota primeiro; 1001 = sem resultado", () => {
  const out = acr.parseIdentifyResponse({ status: { code: 0 }, metadata: { custom_files: [
    { title: "outro", acrid: "x", play_offset_ms: 1000, score: 40 },                       // sem id do SceneShop: ignorado
    { title: "sceneshop:obra-b Título", acrid: "b", play_offset_ms: 5000, score: 70 },     // id pelo título
    { title: "qualquer", acrid: "a", play_offset_ms: 42000, score: 95, sceneshop_work_id: "obra-a" },
  ] } });
  assert.deepEqual(out.matches.map((m) => [m.workId, m.offsetSeconds]), [["obra-a", 42], ["obra-b", 5]]);
  assert.deepEqual(acr.parseIdentifyResponse({ status: { code: 1001, msg: "No result" } }).matches, []);
  assert.throws(() => acr.parseIdentifyResponse({ status: { code: 3001, msg: "Missing/Invalid Access Key" } }), /ACRCloud/);
});

test("sem configuração, nada é chamado e o servidor usa o motor próprio", async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("ACRCLOUD_")) delete process.env[k];
  assert.equal(acr.identifyConfigured(), false);
  assert.equal(acr.registryConfigured(), false);
  assert.deepEqual(await acr.status("qualquer"), { configured: false, state: "not_configured" });
  await assert.rejects(acr.identify(wav(1)), /não configurado/);
});

test("cadastro e identificação contra o simulador (assinatura e token conferidos)", async () => {
  const mock = await import("./acrcloud-mock.mjs");
  const server = await mock.start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    ACRCLOUD_HOST: base, ACRCLOUD_ACCESS_KEY: mock.ACCESS_KEY, ACRCLOUD_ACCESS_SECRET: mock.ACCESS_SECRET,
    ACRCLOUD_BUCKET_ID: mock.BUCKET, ACRCLOUD_CONSOLE_TOKEN: mock.TOKEN, ACRCLOUD_CONSOLE_URL: base,
  });
  const rel = `videos/acr-test-${Date.now()}.webm`;
  fs.copyFileSync(path.join(__dirname, "fixtures", "pilot", "novela.webm"), path.join(uploads.ROOT, rel));
  try {
    const work = { id: "obra-acr", title: "Obra ACR", video: `/uploads/${rel}`, syncId: "SYNC-1" };
    assert.equal((await acr.status(work.id)).state, "not_registered");
    await acr.register(work, "teste");
    await acr.register(work, "teste");                                  // recadastro troca o arquivo, não duplica
    assert.equal(mock.files.length, 1);
    assert.equal(mock.files[0].user_defined.sceneshop_work_id, "obra-acr");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await acr.status(work.id)).state, "ready");

    const hit = await acr.identify(wav(10));
    assert.equal(hit.matches[0].workId, "obra-acr");
    assert.equal(hit.matches[0].offsetSeconds, mock.OFFSET_MS / 1000);
    assert.equal(mock.identifyCalls.at(-1).bytes, mock.identifyCalls.at(-1).declared);
    assert.deepEqual((await acr.identify(wav(10, true))).matches, []);

    process.env.ACRCLOUD_ACCESS_SECRET = "segredo-errado";               // assinatura inválida vira erro claro
    await assert.rejects(acr.identify(wav(2)), /ACRCloud/);
    process.env.ACRCLOUD_CONSOLE_TOKEN = "token-errado";
    await assert.rejects(acr.status("obra-acr"), /401/);
  } finally {
    fs.rmSync(path.join(uploads.ROOT, rel), { force: true });
    server.close();
    for (const k of Object.keys(process.env)) if (k.startsWith("ACRCLOUD_")) delete process.env[k];
  }
});
