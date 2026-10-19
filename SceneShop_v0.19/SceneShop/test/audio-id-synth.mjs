// Áudio sintético para os testes do SceneShop ID: notas, acordes e percussão com uma semente fixa,
// mais funções para "gravar" um trecho como se fosse o microfone do celular numa sala (ruído + eco).
import fs from "node:fs";

export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function synth(seconds, seed, rate = 16000) {
  const r = rng(seed), n = Math.floor(seconds * rate), x = new Float32Array(n);
  const scale = [0, 2, 4, 5, 7, 9, 11, 12], root = 110 + r() * 110, beat = 60 / (80 + r() * 50);
  const add = (start, dur, f, amp, harm = 4, decay = 3) => {
    const a = Math.floor(start * rate), len = Math.floor(dur * rate);
    for (let i = 0; i < len && a + i < n; i++) {
      const t = i / rate, env = Math.min(1, t / 0.005) * Math.exp(-t * decay);
      let v = 0; for (let h = 1; h <= harm; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
      x[a + i] += amp * env * v;
    }
  };
  for (let t = 0; t < seconds - 1; t += beat * 2) {
    for (let k = 0; k < 3; k++) add(t, beat * 2, root * 2 ** (scale[Math.floor(r() * 7)] / 12), 0.12, 5, 1.5);
    for (let k = 0; k < 4; k++) if (r() < 0.75) add(t + (k * beat) / 2, beat / 2, root * 2 * 2 ** (scale[Math.floor(r() * 8)] / 12), 0.22, 3, 6);
    for (let k = 0; k < 2; k++) { // bumbo e caixa
      const a = Math.floor((t + k * beat) * rate);
      for (let i = 0; i < rate * 0.2 && a + i < n; i++) { const tt = i / rate; x[a + i] += 0.5 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12); }
      const b = Math.floor((t + k * beat + beat / 2) * rate);
      for (let i = 0; i < rate * 0.15 && b + i < n; i++) x[b + i] += 0.25 * (r() * 2 - 1) * Math.exp(-(i / rate) * 25);
    }
  }
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) x[i] = (x[i] / peak) * 0.8;
  return x;
}

/** Trecho [start, start+seconds) com eco de sala e ruído (SNR em dB). */
export function roomRecording(x, start, seconds, { rate = 16000, snr = 8, seed = 99 } = {}) {
  const r = rng(seed), a = Math.floor(start * rate), n = Math.floor(seconds * rate), y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = x[a + i] || 0;
  const delays = [[0.031, 0.5], [0.067, 0.35], [0.113, 0.22], [0.171, 0.12]];
  const z = Float32Array.from(y);
  for (const [d, g] of delays) { const k = Math.floor(d * rate); for (let i = k; i < n; i++) z[i] += g * y[i - k]; }
  let p = 0; for (const v of z) p += v * v; p /= n;
  const amp = Math.sqrt(p / 10 ** (snr / 10)) * Math.sqrt(3);
  for (let i = 0; i < n; i++) z[i] += amp * (r() * 2 - 1);
  let peak = 0; for (const v of z) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) z[i] = (z[i] / peak) * 0.7;
  return z;
}

export function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}
export const writeWav = (file, samples, rate) => fs.writeFileSync(file, wav(samples, rate));
