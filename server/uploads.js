/**
 * Envio de arquivos do piloto: vídeos das obras e fotos dos produtos.
 *
 * O arquivo vai direto do navegador para o disco (stream), sem guardar em memória,
 * então vídeos grandes funcionam. Tudo fica em data/uploads/ e é servido em /uploads/.
 * Não usa bibliotecas extras: só o Node.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "data", "uploads");
const KINDS = {
  video: { dir: "videos", exts: ["mp4", "m4v", "webm", "mov"], max: 4 * 1024 ** 3 },
  image: { dir: "images", exts: ["jpg", "jpeg", "png", "webp"], max: 15 * 1024 ** 2 },
};
Object.values(KINDS).forEach((k) => fs.mkdirSync(path.join(ROOT, k.dir), { recursive: true }));

// Assinatura dos primeiros bytes: confere que a foto é mesmo uma imagem
function looksLikeImage(buf) {
  const hex = buf.subarray(0, 12).toString("hex");
  return hex.startsWith("ffd8ff") || hex.startsWith("89504e47") || (hex.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP");
}
function looksLikeVideo(buf) {
  const s = buf.subarray(4, 8).toString("latin1");
  return s === "ftyp" || buf.subarray(0, 4).toString("hex") === "1a45dfa3"; // mp4/mov/m4v | webm
}

/**
 * Recebe o corpo cru da requisição e grava em disco.
 * Resolve com { url, bytes } ou rejeita com uma mensagem amigável.
 */
function receive(req, kind, filename) {
  const k = KINDS[kind];
  return new Promise((resolve, reject) => {
    const ext = String(path.extname(filename || "")).slice(1).toLowerCase();
    if (!k.exts.includes(ext)) return reject(new Error(`Formato não aceito. Use: ${k.exts.join(", ")}.`));
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > k.max) return reject(new Error(`Arquivo grande demais (máx. ${Math.round(k.max / 1024 ** 2)} MB).`));
    const id = Date.now().toString(36) + crypto.randomBytes(5).toString("hex");
    const name = `${id}.${ext === "jpeg" ? "jpg" : ext}`;
    const file = path.join(ROOT, k.dir, name);
    const out = fs.createWriteStream(file);
    let bytes = 0, head = Buffer.alloc(0), failed = false;
    const fail = (msg) => {
      if (failed) return;
      failed = true;
      req.unpipe(out); out.destroy(); fs.unlink(file, () => {});
      reject(new Error(msg));
    };
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16)]);
      if (bytes > k.max) fail("Arquivo grande demais.");
    });
    req.on("aborted", () => fail("Envio interrompido."));
    out.on("error", () => fail("Não foi possível gravar o arquivo."));
    out.on("finish", () => {
      if (failed) return;
      const ok = kind === "image" ? looksLikeImage(head) : looksLikeVideo(head);
      if (!ok || bytes === 0) { fs.unlink(file, () => {}); return reject(new Error(kind === "image" ? "O arquivo não é uma imagem válida." : "O arquivo não é um vídeo válido.")); }
      resolve({ url: `/uploads/${k.dir}/${name}`, bytes });
    });
    req.pipe(out);
  });
}

// Grava uma imagem vinda como data URL (miniaturas de cena capturadas no navegador)
function saveDataUrl(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new Error("Imagem inválida.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 2 * 1024 ** 2 || !looksLikeImage(buf)) throw new Error("Imagem inválida.");
  const name = `${Date.now().toString(36)}${crypto.randomBytes(5).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(ROOT, "images", name), buf);
  return `/uploads/images/${name}`;
}

const isUploadUrl = (u) => /^\/uploads\/(images|videos)\/[a-z0-9]+\.(jpg|png|webp|mp4|m4v|webm|mov)$/.test(String(u || ""));

module.exports = { ROOT, receive, saveDataUrl, isUploadUrl };
