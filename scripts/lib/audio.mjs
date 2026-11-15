// 音声のデコード・タグ読み取り・変換。ffmpeg があれば全形式、無ければ WAV のみ扱う。
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let ffmpegPath;
export function findFfmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  if (process.env.FFMPEG_PATH === "none") return (ffmpegPath = null); // ffmpeg 無し環境の再現用
  for (const candidate of [process.env.FFMPEG_PATH, "ffmpeg"].filter(Boolean)) {
    const result = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (result.status === 0) return (ffmpegPath = candidate);
  }
  return (ffmpegPath = null);
}

function ffmpeg(args, options = {}) {
  return spawnSync(findFfmpeg(), ["-hide_banner", "-nostdin", ...args], {
    encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024, ...options
  });
}

// タグ（title/artist/…）と、ストリーム情報（サンプルレート・チャンネル・ビットレート）。
export function probe(file) {
  const info = { tags: {}, sampleRate: null, channels: null, bitrate: null, hasCoverArt: false };
  if (!findFfmpeg()) return info;
  const result = ffmpeg(["-i", file, "-f", "ffmetadata", "-"]);
  for (const line of String(result.stdout || "").split(/\r?\n/)) {
    if (line.startsWith("[")) break;
    if (line.startsWith(";")) continue;
    const at = line.indexOf("=");
    if (at > 0) info.tags[line.slice(0, at).toLowerCase()] = line.slice(at + 1).replace(/\\([=;#\\\n])/g, "$1").trim();
  }
  const stderr = String(result.stderr || "");
  const audio = /Stream #\d+:\d+[^\n]*: Audio: ([^\n]+)/.exec(stderr);
  if (audio) {
    const rate = /(\d+) Hz/.exec(audio[1]);
    if (rate) info.sampleRate = Number(rate[1]);
    if (/\bmono\b/.test(audio[1])) info.channels = 1;
    else if (/\bstereo\b/.test(audio[1])) info.channels = 2;
    const kbps = /(\d+) kb\/s/.exec(audio[1]);
    if (kbps) info.bitrate = Number(kbps[1]);
  }
  info.hasCoverArt = /Stream #\d+:\d+[^\n]*: Video: [^\n]*attached pic/.test(stderr);
  return info;
}

export function extractCoverArt(file, output) {
  if (!findFfmpeg()) return false;
  const result = ffmpeg(["-v", "error", "-i", file, "-an", "-map", "0:v:0", "-frames:v", "1", "-y", output]);
  return result.status === 0 && existsSync(output) && statSync(output).size > 0;
}

export function transcodeToMp3(file, output, bitrate = "256k") {
  const result = ffmpeg(["-v", "error", "-i", file, "-vn", "-map_metadata", "0", "-codec:a", "libmp3lame", "-b:a", bitrate, "-y", output]);
  if (result.status !== 0) throw new Error(`mp3 変換に失敗: ${String(result.stderr).trim().split("\n").at(-1)}`);
}

export function canDecode(file) {
  return Boolean(findFfmpeg()) || path.extname(file).toLowerCase() === ".wav";
}

// → { channels: Float32Array[], sampleRate, sourceRate, sourceChannels }
export async function decodeAudio(file) {
  if (findFfmpeg()) return decodeWithFfmpeg(file);
  if (path.extname(file).toLowerCase() === ".wav") return decodeWav(await readFile(file));
  throw new Error("ffmpeg が見つからないため、WAV 以外はデコードできません");
}

const MAX_PCM_BYTES = 240 * 1024 * 1024;

function decodeWithFfmpeg(file) {
  const info = probe(file);
  const channelCount = info.channels === 1 ? 1 : 2;
  const temp = mkdtempSync(path.join(os.tmpdir(), "otodana-"));
  const raw = path.join(temp, "pcm.f32");
  try {
    let sampleRate = 24000;
    for (;;) {
      const result = ffmpeg(["-v", "error", "-i", file, "-vn", "-ac", String(channelCount), "-ar", String(sampleRate), "-f", "f32le", "-y", raw]);
      if (result.status !== 0) throw new Error(`デコードに失敗: ${String(result.stderr).trim().split("\n").at(-1)}`);
      // 24 kHz・最大2chの作業PCMを上限内に収める。
      if (statSync(raw).size > MAX_PCM_BYTES) throw new Error('Decoded audio exceeds the 20-minute analysis limit');
      break;
    }
    const frames = Math.floor(statSync(raw).size / (4 * channelCount));
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    const chunkFrames = 262144;
    const chunk = new Float32Array(chunkFrames * channelCount);
    const bytes = new Uint8Array(chunk.buffer);
    const fd = openSync(raw, "r");
    try {
      for (let done = 0; done < frames;) {
        const want = Math.min(chunkFrames, frames - done);
        let read = 0;
        while (read < want * 4 * channelCount) {
          const n = readSync(fd, bytes, read, want * 4 * channelCount - read, null);
          if (n <= 0) break;
          read += n;
        }
        const got = Math.floor(read / (4 * channelCount));
        if (!got) break;
        for (let c = 0; c < channelCount; c++) {
          const target = channels[c];
          for (let i = 0; i < got; i++) target[done + i] = chunk[i * channelCount + c];
        }
        done += got;
      }
    } finally {
      closeSync(fd);
    }
    return { channels, sampleRate, sourceRate: info.sampleRate || sampleRate, sourceChannels: info.channels || channelCount, bitrate: info.bitrate };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// PCM 8/16/24/32bit と IEEE float 32/64bit の WAV。ffmpeg が無い環境とテスト用。
export function decodeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tag = (at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (view.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("WAV ではありません");
  let format = null, dataAt = -1, dataSize = 0;
  for (let at = 12; at + 8 <= view.byteLength;) {
    const id = tag(at), size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      format = { code: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true), sampleRate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
      if (format.code === 0xfffe && size >= 26) format.code = view.getUint16(at + 32, true);
    } else if (id === "data") {
      dataAt = at + 8;
      dataSize = Math.min(size, view.byteLength - dataAt);
      break;
    }
    at += 8 + size + (size & 1);
  }
  if (!format || dataAt < 0) throw new Error("WAV の fmt / data チャンクがありません");
  const { code, channels: count, sampleRate, bits } = format;
  if (!count || count > 32 || !sampleRate || sampleRate > 384000) throw new Error('Invalid WAV format');
  const step = bits / 8;
  let read;
  if (code === 1 && bits === 8) read = (at) => (view.getUint8(at) - 128) / 128;
  else if (code === 1 && bits === 16) read = (at) => view.getInt16(at, true) / 32768;
  else if (code === 1 && bits === 24) read = (at) => ((view.getInt8(at + 2) << 16) | (view.getUint8(at + 1) << 8) | view.getUint8(at)) / 8388608;
  else if (code === 1 && bits === 32) read = (at) => view.getInt32(at, true) / 2147483648;
  else if (code === 3 && bits === 32) read = (at) => view.getFloat32(at, true);
  else if (code === 3 && bits === 64) read = (at) => view.getFloat64(at, true);
  else throw new Error(`未対応の WAV 形式です (format ${code}, ${bits}bit)`);
  const frames = Math.floor(dataSize / (step * count));
  if (!frames || frames / sampleRate > 1200 || frames * Math.min(count, 2) * 4 > MAX_PCM_BYTES) throw new Error('WAV exceeds analysis limits');
  const used = Math.min(count, 2);
  const channels = Array.from({ length: used }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < used; c++) channels[c][i] = read(dataAt + (i * count + c) * step);
  return { channels, sampleRate, sourceRate: sampleRate, sourceChannels: count, bitrate: Math.round(sampleRate * count * bits / 1000) };
}
