// dt-cue の解析コア（3バンド波形 + 3方式BPM）をビルド時に Node で実行し、配信用に小さく詰める。
// ブラウザ側のフォールバック解析と同じ site/src/analysis-core.js をそのまま使う。
import { analyzePCM } from "../../site/src/analysis-core.js";
import { ANALYZER_VERSION } from "./constants.mjs";
import { decodeAudio } from "./audio.mjs";

const WAVE_POINTS = 2400; // 曲ページの波形の横解像度
const MINI_POINTS = 96;   // 一覧・プレイヤーバーの簡易波形

export async function analyzeFile(file, hash) {
  const pcm = await decodeAudio(file);
  if (!pcm.channels[0]?.length) throw new Error("音声データが空です");
  const result = analyzePCM(pcm.channels, pcm.sampleRate);
  return packAnalysis(result, { hash, sourceRate: pcm.sourceRate, sourceChannels: pcm.sourceChannels, bitrate: pcm.bitrate });
}

export function packAnalysis(result, extra = {}) {
  const count = result.peak.length;
  const points = Math.min(count, WAVE_POINTS);
  const reduce = (data, n) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const from = Math.floor(i * count / n), to = Math.max(from + 1, Math.floor((i + 1) * count / n));
      let max = 0;
      for (let j = from; j < to; j++) if (data[j] > max) max = data[j];
      out[i] = max;
    }
    return out;
  };
  const bands = { low: reduce(result.low, points), mid: reduce(result.mid, points), high: reduce(result.high, points), peak: reduce(result.peak, points) };
  let scale = 0;
  for (const data of Object.values(bands)) for (const value of data) if (value > scale) scale = value;
  scale = scale || 1;
  const pack = (data) => Buffer.from(Uint8Array.from(data, (v) => Math.min(255, Math.round(v / scale * 255)))).toString("base64");
  const miniSource = reduce(result.peak, Math.min(count, MINI_POINTS));
  const round = (value, digits) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
  const candidate = (c) => ({ bpm: round(c.bpm, 1), confidence: round(c.confidence, 3), beatOffset: round(c.beatOffset, 4), ...(c.support ? { support: c.support, primarySupport: c.primarySupport } : {}) });
  return {
    v: ANALYZER_VERSION,
    hash: extra.hash || null,
    duration: round(result.duration, 3),
    sampleRate: extra.sourceRate || result.sampleRate,
    channels: extra.sourceChannels || result.channels,
    bitrate: extra.bitrate || null,
    samplePeak: round(result.samplePeak, 5),
    rms: round(result.rms, 5),
    bpm: result.bpm === null ? null : round(result.bpm, 1),
    confidence: round(result.confidence, 3),
    beatOffset: round(result.beatOffset, 4),
    reason: result.reason || "",
    tempoCandidates: result.tempoCandidates.map(candidate),
    engines: result.engines.map((e) => ({ id: e.id, short: e.short, label: e.label, reason: e.reason || "", candidates: e.candidates.map(candidate) })),
    mini: Array.from(miniSource, (v) => Math.round(Math.pow(v / scale, 0.6) * 100)),
    wave: { n: points, scale: round(scale, 5), low: pack(bands.low), mid: pack(bands.mid), high: pack(bands.high), peak: pack(bands.peak) }
  };
}

export function unpackBand(base64) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
