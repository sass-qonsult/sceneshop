// SceneShop ID: índice da obra, reconhecimento de um trecho gravado "na sala" e recusa do que não está no catálogo.
const test = require("node:test");
const assert = require("node:assert/strict");

test("SceneShop ID reconhece a obra e a posição, e recusa áudio de fora", async () => {
  const { synth, roomRecording, wav } = await import("./audio-id-synth.mjs");
  const aid = require("../server/audio-id");
  const down = (x) => { const y = new Float32Array(Math.floor(x.length / 2)); for (let i = 0; i < y.length; i++) y[i] = (x[2 * i] + x[2 * i + 1]) / 2; return y; }; // 16 kHz -> 8 kHz
  const works = { "obra-a": synth(90, 11), "obra-b": synth(90, 12), "obra-c": synth(90, 13) };
  const indexes = Object.entries(works).map(([id, x]) => { const idx = aid.sortIndex(aid.landmarks(down(x))); return { meta: { workId: id, count: idx.hashes.length }, ...idx }; });

  // gravação de 10 s, a partir de 41,5 s da obra B, com eco e ruído (8 dB)
  const rec = roomRecording(works["obra-b"], 41.5, 10, { snr: 8 });
  const r = aid.match(aid.decodeWav(wav(rec, 16000)), { indexes });
  const best = aid.decide(r);
  assert.ok(best, JSON.stringify(r.matches.slice(0, 3)));
  assert.equal(best.workId, "obra-b");
  assert.ok(Math.abs(best.offsetSeconds - 41.5) < 0.2, `posição ${best.offsetSeconds}`);

  // restringir à obra da sessão
  assert.equal(aid.decide(aid.match(aid.decodeWav(wav(rec, 16000)), { indexes, only: ["obra-a"] })), null);

  // fora do catálogo: outra música do mesmo "estilo"
  const other = roomRecording(synth(40, 77), 10, 10, { snr: 8 });
  assert.equal(aid.decide(aid.match(aid.decodeWav(wav(other, 16000)), { indexes })), null, "não reconhece o que não foi indexado");

  // silêncio
  assert.equal(aid.decide(aid.match(new Float32Array(8000 * 10), { indexes })), null);

  // arquivo de índice: grava e lê de volta
  const fs = require("fs"), os = require("os"), path = require("path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ssid-"));
  const file = path.join(tmp, "x.ssid");
  const i0 = indexes[1];
  const orig = aid.DIR; // writeIndex usa o diretório padrão; aqui só conferimos o formato
  fs.mkdirSync(aid.DIR, { recursive: true });
  aid.writeIndex("teste-indice", { hashes: i0.hashes, times: i0.times }, { duration: 90 });
  const back = aid.readIndex(path.join(orig, "teste-indice.ssid"));
  assert.equal(back.meta.count, i0.hashes.length);
  assert.deepEqual(Array.from(back.hashes.slice(0, 50)), Array.from(i0.hashes.slice(0, 50)));
  fs.unlinkSync(path.join(orig, "teste-indice.ssid"));
  fs.rmSync(tmp, { recursive: true, force: true });
  void file;
});

test("WAV: rejeita formato inválido e reamostra 48 kHz", () => {
  const aid = require("../server/audio-id");
  assert.throws(() => aid.decodeWav(Buffer.from("nada disso é wav, nem perto de 44 bytes................")));
  const n = 48000, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  assert.equal(aid.decodeWav(b).length, 8000);
});
