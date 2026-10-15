// SIMULADOR da API do Gemini, só para testes automáticos (não é o Gemini de verdade).
// Reproduz o fluxo real: lista de modelos, envio do vídeo em duas etapas (Files API),
// processamento, generateContent com resposta em JSON e exclusão do arquivo.
// A resposta usa um roteiro fixo do vídeo "Kimono: 4 jeitos de usar", escrito à mão.
// Uso: node test/gemini-mock.mjs [porta]   (padrão 3999)
import http from "node:http";

const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 3999);
export const KEY = "AIzaSyTESTE-simulador-0000000000000";
const files = {};
let polls = 0;

// roteiro: [início, fim, título, itens]; box_2d = [ymin, xmin, ymax, xmax] de 0 a 1000
const SCRIPT = [
  ["00:00", "00:09", "Abertura: camisa xadrez", [
    { name: "Camisa xadrez caramelo", category: "Moda", description: "Camisa de botão em xadrez caramelo e branco, manga longa.", bestTime: "00:03", box_2d: [330, 60, 1000, 900], hint: null },
  ]],
  ["00:09", "00:19", "Look 1: kimono com broche", [
    { name: "Kimono floral azul e branco", category: "Moda", description: "Kimono amplo, estampa floral azul-marinho com barrado vermelho.", bestTime: "00:14", box_2d: [230, 120, 820, 880], hint: "kimono" },
    { name: "Top cropped vermelho de alças", category: "Moda", description: "Top curto vermelho, alças finas.", bestTime: "00:13", box_2d: [330, 380, 560, 640], hint: "top" },
    { name: "Calça pantalona marrom", category: "Moda", description: "Calça de cintura alta, pernas largas, marrom.", bestTime: "00:12", box_2d: [560, 300, 1000, 720], hint: "iorane", conf: 0.58 },
  ]],
  ["00:19", "00:26", "Look 2: com cinto", [
    { name: "Kimono floral azul e branco", category: "Moda", description: "Kimono fechado com cinto dourado.", bestTime: "00:21", box_2d: [240, 110, 800, 890], hint: "kimono" },
    { name: "Cinto de elos dourados", category: "Acessórios", description: "Cinto de corrente com elos retangulares dourados.", bestTime: "00:22", box_2d: [470, 330, 560, 690], hint: null },
  ]],
  ["00:26", "00:33", "Look 3: por dentro da saia", [
    { name: "Saia midi pink", category: "Moda", description: "Saia lápis midi pink, cintura alta.", bestTime: "00:30", box_2d: [500, 280, 1000, 720], hint: "saia" },
    { name: "Kimono floral azul e branco", category: "Moda", description: "Kimono por dentro da saia, usado como blusa.", bestTime: "00:29", box_2d: [180, 140, 560, 860], hint: "kimono" },
  ]],
  ["00:33", "00:37", "Look 4: solto e aberto", [
    { name: "Kimono floral azul e branco", category: "Moda", description: "Kimono aberto sobre top vermelho.", bestTime: "00:34", box_2d: [220, 60, 900, 940], hint: "kimono" },
    { name: "Top cropped vermelho de alças", category: "Moda", description: "Top curto vermelho.", bestTime: "00:35", box_2d: [330, 380, 560, 640], hint: "top" },
  ]],
  ["00:37", "00:58", "Peças disponíveis no cabide", [
    { name: "Saia midi pink", category: "Moda", description: "Saia pink no cabide.", visibleText: "Saia NV · Tam: 38 · R$ 289,90", bestTime: "00:37", box_2d: [80, 40, 1000, 960], hint: "saia" },
    { name: "Top vermelho de alças", category: "Moda", description: "Top vermelho no cabide.", visibleText: "Top Pietie · Tam: M · R$ 69,90", bestTime: "00:41", box_2d: [100, 60, 700, 960], hint: "top" },
    { name: "Kimono floral", category: "Moda", description: "Kimono estampado no cabide.", visibleText: "Kimono Maria Filó · Tam: G · R$ 189,90", bestTime: "00:45", box_2d: [80, 20, 1000, 980], hint: "kimono" },
    { name: "Calça de alfaiataria preta", category: "Moda", description: "Calça preta de alfaiataria, cintura alta.", visibleText: "Calça Animale Alfaiataria · Tam: 40 · R$ 289,90", bestTime: "00:50", box_2d: [100, 80, 1000, 900], hint: "animale" },
    { name: "Calça cargo marrom", category: "Moda", description: "Calça cargo cor chocolate com bolsos laterais.", visibleText: "Calça Iorane · Tam: 40 · R$ 219,90", bestTime: "00:56", box_2d: [100, 60, 1000, 960], hint: "iorane" },
  ]],
  ["00:58", "01:14", "Encerramento: Casa Bossa Brechó", []],
];

function respond(prompt) {
  const catalog = [...prompt.matchAll(/^- id: (\S+) \| ([^|]+)\|/gm)].map((m) => ({ id: m[1], name: m[2].toLowerCase() }));
  const pick = (hint) => (hint && catalog.find((p) => p.name.includes(hint))) || null;
  const item = (it) => {
    const p = pick(it.hint);
    const { hint, conf, ...rest } = it;
    return { ...rest, productId: p ? p.id : "", matchConfidence: p ? conf ?? (it.visibleText ? 0.95 : 0.86) : 0 };
  };
  if (/UMA cena só/.test(prompt)) {
    const seen = new Set();
    const items = SCRIPT.flatMap((s) => s[3]).filter((i) => (i.hint && !seen.has(i.hint) ? seen.add(i.hint) : !i.hint)).map(item);
    return { scenes: [{ start: "00:00", end: "01:14", title: "Kimono: 4 jeitos de usar", items }] };
  }
  return { scenes: SCRIPT.map(([start, end, title, items]) => ({ start, end, title, items: items.map(item) })) };
}

const json = (res, code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };

export function start(port = PORT) {
  const server = http.createServer((req, res) => {
    let body = [];
    req.on("data", (c) => body.push(c));
    req.on("end", () => {
      body = Buffer.concat(body);
      const url = new URL(req.url, "http://x");
      const authed = req.headers["x-goog-api-key"] === KEY;
      if (url.pathname.startsWith("/upload-session/")) {
        const id = url.pathname.split("/").pop();
        files[id] = { name: `files/${id}`, uri: `https://generativelanguage.googleapis.com/v1beta/files/${id}`, mimeType: req.headers["content-type"] || "video/webm", sizeBytes: String(body.length), state: "PROCESSING" };
        return json(res, 200, { file: files[id] });
      }
      if (!authed) return json(res, 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
      if (req.method === "GET" && url.pathname === "/v1beta/models") {
        return json(res, 200, { models: [
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3-flash-preview", supportedGenerationMethods: ["generateContent"] },
        ] });
      }
      if (req.method === "POST" && url.pathname === "/upload/v1beta/files") {
        const id = Math.random().toString(36).slice(2, 10);
        return json(res, 200, {}, { "X-Goog-Upload-URL": `http://127.0.0.1:${port}/upload-session/${id}` });
      }
      const fm = url.pathname.match(/^\/v1beta\/files\/(\w+)$/);
      if (fm) {
        const f = files[fm[1]];
        if (!f) return json(res, 404, { error: { message: "not found" } });
        if (req.method === "DELETE") { delete files[fm[1]]; return json(res, 200, {}); }
        if (++polls % 2 === 0) f.state = "ACTIVE";
        return json(res, 200, f);
      }
      const gm = url.pathname.match(/^\/v1beta\/models\/([^:]+):generateContent$/);
      if (gm && req.method === "POST") {
        const reqBody = JSON.parse(body.toString() || "{}");
        const parts = reqBody.contents[0].parts;
        const fileRef = parts.find((p) => p.file_data);
        if (!fileRef || !Object.values(files).some((f) => f.uri === fileRef.file_data.file_uri && f.state === "ACTIVE")) {
          return json(res, 400, { error: { message: "File not ACTIVE or unknown." } });
        }
        const prompt = parts.map((p) => p.text || "").join("\n");
        const text = JSON.stringify(respond(prompt));
        return json(res, 200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 21540, candidatesTokenCount: 1480, totalTokenCount: 23020 }, modelVersion: gm[1] });
      }
      json(res, 404, { error: { message: `rota não simulada: ${req.method} ${url.pathname}` } });
    });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await start();
  console.log(`Simulador do Gemini em http://127.0.0.1:${PORT} (chave de teste: ${KEY})`);
}
