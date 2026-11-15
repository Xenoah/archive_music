// 曲ページ用の解析データを用意する。
// 1) ビルド時に作った analysis.json があればそれを読む（数KB）。
// 2) 無ければ dt-cue と同じく、ブラウザ内でデコードして Worker で解析する。
const cache = new Map();
const MAX_FALLBACK_BYTES = 80 * 1024 * 1024;

function decodeBand(base64) {
  const binary = atob(base64), out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function loadAnalysis(track, resolve, onProgress = () => {}) {
  if (!cache.has(track.slug)) {
    const job = (track.analysis ? fetchPrebuilt(track, resolve) : analyzeInBrowser(track, resolve, onProgress));
    cache.set(track.slug, job);
    job.catch(() => cache.delete(track.slug));
  }
  return cache.get(track.slug);
}

async function fetchPrebuilt(track, resolve) {
  const response = await fetch(resolve(track.analysis));
  if (!response.ok) throw new Error(`analysis.json: HTTP ${response.status}`);
  const a = await response.json(), w = a.wave;
  return { ...a, source: 'build', wave: { n: w.n, norm: w.scale / 255, low: decodeBand(w.low), mid: decodeBand(w.mid), high: decodeBand(w.high), peak: decodeBand(w.peak) } };
}

async function analyzeInBrowser(track, resolve, onProgress) {
  if (track.audioBytes > MAX_FALLBACK_BYTES) throw new Error('too-large');
  const response = await fetch(resolve(track.audio));
  if (!response.ok) throw new Error(`audio: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buffer = await new Offline(1, 1, 44100).decodeAudioData(bytes);
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice());
  const result = await new Promise((done, fail) => {
    const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) return onProgress(data.progress);
      worker.terminate();
      if (data.error) fail(new Error(data.error)); else done(data.result);
    };
    worker.onerror = event => { worker.terminate(); fail(new Error(event.message || 'worker')); };
    worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(c => c.buffer));
  });
  return {
    source: 'browser', duration: result.duration, sampleRate: result.sampleRate, channels: result.channels,
    samplePeak: result.samplePeak, rms: result.rms, bpm: result.bpm, confidence: result.confidence, beatOffset: result.beatOffset,
    reason: result.reason, tempoCandidates: result.tempoCandidates, engines: result.engines,
    wave: { n: result.peak.length, norm: 1, low: result.low, mid: result.mid, high: result.high, peak: result.peak }
  };
}

// 手動指定の BPM に合うビート位相を、解析候補（同じテンポか、その 1/2・1/4）から借りる。
export function beatOffsetFor(bpm, analysis) {
  if (!bpm || !analysis) return 0;
  const candidates = [...(analysis.tempoCandidates || []), ...(analysis.engines || []).flatMap(e => e.candidates)];
  const near = (a, b) => Math.abs(a - b) < Math.max(.7, b * .012);
  for (const multiple of [1, 2, 4]) {
    const match = candidates.find(c => near(c.bpm * multiple, bpm));
    if (match) return match.beatOffset % (60 / bpm);
  }
  const double = candidates.find(c => near(c.bpm / 2, bpm));
  return double ? double.beatOffset : 0;
}
