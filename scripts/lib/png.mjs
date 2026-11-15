// 依存なしの PNG 書き出しと、波形から作る自動カバー画像。
import zlib from "node:zlib";
import { unpackBand } from "./analysis.mjs";
import { hashString } from "./util.mjs";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))
  ]);
}

function hsl(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const LOW = [253, 172, 100], MID = [89, 198, 218], HIGH = [180, 156, 255];

// 曲ごとに色相が決まる背景 + LOW/MID/HIGH の3バンド波形。
export function renderAutoCover(analysis, slug, size = 800) {
  const rgb = Buffer.alloc(size * size * 3);
  const hue = hashString(slug) % 360;
  const top = hsl(hue, 0.42, 0.17), bottom = hsl((hue + 40) % 360, 0.5, 0.06);
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const glow = Math.max(0, 1 - Math.hypot(x - size * 0.5, y - size * 0.5) / (size * 0.75)) * 0.5;
      const at = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) rgb[at + c] = Math.min(255, Math.round((top[c] * (1 - t) + bottom[c] * t) * (1 + glow)));
    }
  }
  const rect = (x0, y0, w, h, color) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(size, Math.round(y0 + h)); y++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x0 + w); x++) rgb.set(color, (y * size + x) * 3);
    }
  };
  const bars = 80, pitch = Math.floor(size * 0.8 / bars), width = Math.max(1, pitch - 3);
  const left = Math.round((size - bars * pitch) / 2), center = size / 2, maxHalf = size * 0.3;
  const wave = analysis.wave;
  const bands = ["low", "mid", "high", "peak"].map((key) => unpackBand(wave[key]));
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(b * wave.n / bars), to = Math.max(from + 1, Math.floor((b + 1) * wave.n / bars));
    const max = [0, 0, 0, 0];
    for (let i = from; i < to; i++) for (let k = 0; k < 4; k++) if (bands[k][i] > max[k]) max[k] = bands[k][i];
    const sum = max[0] + max[1] + max[2] || 1;
    const total = Math.max(2, Math.pow(max[3] / 255, 0.65) * maxHalf);
    const l = total * max[0] / sum, m = total * max[1] / sum, h = total * max[2] / sum;
    const x = left + b * pitch;
    rect(x, center - l, width, l * 2, LOW);
    rect(x, center - l - m, width, m, MID);
    rect(x, center + l, width, m, MID);
    rect(x, center - l - m - h, width, h, HIGH);
    rect(x, center + l + m, width, h, HIGH);
  }
  return encodePng(size, size, rgb);
}
