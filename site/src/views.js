// 3バンド波形・オシロスコープ・FFT の描画。
// dt-cue (https://github.com/Xenoah/dt-cue_precision-media-player, MIT) の site/src/views.js を、
// 事前解析データ + <audio> ストリーミング再生向けに組み替えたもの。配色と描画式は dt-cue と同じ。
export const C = { grid: '#27343e', muted: '#78909f', accent: '#c3f96b', low: '#fdac64', mid: '#59c6da', high: '#b49cff' };

function setup(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); return { ctx, w, h };
}

// source: { duration(), time() → 再生位置 or null（このトラックを再生していないとき）, playing(), seek(t) }
export class WaveView {
  constructor(canvas, source) {
    this.canvas = canvas; this.source = source; this.data = null; this.zoom = 1; this.start = 0; this.bpm = 0; this.beatOffset = 0; this.grid = true; this.scrubbing = false;
    const seek = e => { const r = canvas.getBoundingClientRect(); source.seek(this.start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.span); this.draw(); };
    canvas.addEventListener('pointerdown', e => { if (!this.duration || e.button) return; canvas.setPointerCapture(e.pointerId); this.scrubbing = true; seek(e); });
    canvas.addEventListener('pointermove', e => { if (this.scrubbing) seek(e); });
    canvas.addEventListener('pointerup', () => this.scrubbing = false); canvas.addEventListener('pointercancel', () => this.scrubbing = false);
    canvas.addEventListener('wheel', e => {
      if (!this.duration || (!e.ctrlKey && this.zoom === 1)) return; e.preventDefault();
      if (e.ctrlKey) { const r = canvas.getBoundingClientRect(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.25 : 1 / 1.25), this.start + (e.clientX - r.left) / r.width * this.span); }
      else { this.start += (e.deltaX || e.deltaY) / canvas.clientWidth * this.span; this.draw(); }
    }, { passive: false });
    this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(canvas);
  }
  destroy() { this.resize.disconnect(); }
  get duration() { return this.source.duration() || 0; }
  get span() { return (this.duration || 30) / this.zoom; }
  setData(data) { this.data = data; this.draw(); }
  setTempo(bpm, beatOffset) { this.bpm = bpm || 0; this.beatOffset = beatOffset || 0; this.draw(); }
  setZoom(zoom, anchor) {
    const before = this.span, center = anchor ?? this.source.time() ?? this.start + before / 2, ratio = (center - this.start) / before;
    this.zoom = Math.max(1, Math.min(64, Number(zoom) || 1)); this.start = center - ratio * this.span; this.draw(); this.onzoom?.(this.zoom);
  }
  follow() { const t = this.source.time(); if (t !== null && this.source.playing() && !this.scrubbing && this.zoom > 1 && (t > this.start + this.span || t < this.start)) this.start = t - this.span * .15; }
  draw() {
    const { ctx, w, h } = setup(this.canvas), d = this.data, span = this.span, duration = this.duration;
    this.start = Math.max(0, Math.min(Math.max(0, duration - span), this.start));
    const x = t => (t - this.start) / span * w, top = 22;
    ctx.lineWidth = 1; ctx.font = '11px ui-monospace, Consolas, monospace'; ctx.fillStyle = C.muted; ctx.strokeStyle = C.grid;
    const desired = span / Math.max(2, w / 100), ticks = [.001, .005, .01, .025, .05, .1, .25, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600];
    const interval = ticks.find(v => v >= desired) || 3600;
    for (let t = Math.ceil(this.start / interval) * interval; t <= this.start + span; t += interval) {
      const px = x(t); ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, h); ctx.stroke();
      const label = t >= 60 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : t.toFixed(interval < 1 ? (interval < .01 ? 3 : 2) : 0) + 's'; ctx.fillText(label, px + 5, 14);
    }
    const cy = top + (h - top) / 2;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    if (this.grid && this.bpm > 0 && duration) {
      const beat = 60 / this.bpm, skip = Math.max(1, 2 ** Math.ceil(Math.log2(span / beat / 120)));
      for (let n = Math.ceil((this.start - this.beatOffset) / beat / skip) * skip; ; n += skip) {
        const t = this.beatOffset + n * beat; if (t > this.start + span) break;
        ctx.strokeStyle = n % (skip * 4) === 0 ? '#566340' : '#3c4533'; ctx.beginPath(); ctx.moveTo(x(t), top); ctx.lineTo(x(t), h); ctx.stroke();
      }
    }
    if (d && duration) {
      const scale = (h - top - 14) * .48, perSecond = d.n / duration;
      for (let px = 0; px < w; px++) {
        const i0 = Math.max(0, Math.floor((this.start + px / w * span) * perSecond));
        const i1 = Math.min(d.n, Math.max(i0 + 1, Math.ceil((this.start + (px + 1) / w * span) * perSecond)));
        let lo = 0, mi = 0, hi = 0, pk = 0; for (let i = i0; i < i1; i++) { lo = Math.max(lo, d.low[i]); mi = Math.max(mi, d.mid[i]); hi = Math.max(hi, d.high[i]); pk = Math.max(pk, d.peak[i]); }
        const sum = lo + mi + hi || 1, total = Math.pow(pk * d.norm, .65) * scale, l = total * lo / sum, m = total * mi / sum, hh = total * hi / sum;
        ctx.fillStyle = C.low; ctx.fillRect(px, cy - l, 1, l * 2);
        ctx.fillStyle = C.mid; ctx.fillRect(px, cy - l - m, 1, m); ctx.fillRect(px, cy + l, 1, m);
        ctx.fillStyle = C.high; ctx.fillRect(px, cy - l - m - hh, 1, hh); ctx.fillRect(px, cy + l + m, 1, hh);
      }
    }
    const now = this.source.time();
    if (duration && now !== null) {
      const px = x(now);
      ctx.fillStyle = 'rgba(16,20,23,.5)'; ctx.fillRect(Math.max(0, px), top, w, h - top); // 未再生部分を沈める
      ctx.fillStyle = C.accent; ctx.fillRect(px - 1, top - 2, 2, h - top + 2); ctx.beginPath(); ctx.moveTo(px - 5, top - 1); ctx.lineTo(px + 5, top - 1); ctx.lineTo(px, top + 5); ctx.fill();
    }
  }
}

// 一覧・プレイヤーバー用の小さな波形（peak のみ）。progress は 0..1 か null。
export function drawMini(canvas, mini, progress) {
  const { ctx, w, h } = setup(canvas);
  const bars = Math.max(8, Math.floor(w / 3)), played = progress === null ? -1 : progress * bars;
  for (let b = 0; b < bars; b++) {
    let value = 18;
    if (mini?.length) { const from = Math.floor(b * mini.length / bars), to = Math.max(from + 1, Math.floor((b + 1) * mini.length / bars)); value = 0; for (let i = from; i < to; i++) value = Math.max(value, mini[i]); }
    const amp = Math.max(1, value / 100 * h * .48);
    ctx.fillStyle = b < played ? C.accent : '#506777'; ctx.fillRect(b * w / bars, h / 2 - amp, Math.max(1, w / bars - 1), amp * 2);
  }
}

// player: { playing, left, right, analyser (AnalyserNode|null), sampleRate }
export class ScopeView {
  constructor(canvas, player, mode = 'osc') { this.canvas = canvas; this.player = player; this.mode = mode; this.window = .02; this.left = new Float32Array(4096); this.right = new Float32Array(4096); this.freq = new Float32Array(2048); }
  samples() {
    const p = this.player; this.left.fill(0); this.right.fill(0);
    if (p.playing && p.left) { p.left.getFloatTimeDomainData(this.left); p.right.getFloatTimeDomainData(this.right); }
  }
  grid(ctx, w, h) { ctx.lineWidth = 1; ctx.strokeStyle = '#24333d'; ctx.beginPath(); for (let i = 1; i < 8; i++) { ctx.moveTo(w * i / 8, 0); ctx.lineTo(w * i / 8, h); } for (let j = 1; j < 4; j++) { ctx.moveTo(0, h * j / 4); ctx.lineTo(w, h * j / 4); } ctx.stroke(); ctx.strokeStyle = '#3a4a56'; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); }
  trace(ctx, w, h, data, color, count, offset = 0) { ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath(); for (let x = 0; x < w; x++) { const i = Math.min(data.length - 1, offset + Math.floor(x / w * count)); const y = h / 2 - data[i] * h * .4; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
  draw() {
    const { ctx, w, h } = setup(this.canvas), p = this.player, sr = p.sampleRate || 48000;
    if (this.mode === 'osc') {
      this.samples(); this.grid(ctx, w, h);
      const n = Math.min(3000, Math.floor(sr * this.window)); let offset = 0;
      // 簡易の立ち上がりトリガーで波形を静止させる
      if (p.playing) { for (let i = 1; i < Math.min(900, 4096 - n); i++) if (this.left[i - 1] <= 0 && this.left[i] > .005) { offset = i; break; } }
      if (p.playing) { this.trace(ctx, w, h, this.right, C.high, n, offset); this.trace(ctx, w, h, this.left, C.mid, n, offset); }
    } else {
      this.grid(ctx, w, h);
      this.freq.fill(-100); if (p.playing) p.analyser?.getFloatFrequencyData(this.freq);
      const bars = w < 260 ? 36 : 70;
      for (let i = 0; i < bars; i++) {
        const hz = 20 * Math.pow(1000, i / bars), hz2 = 20 * Math.pow(1000, (i + 1) / bars);
        const center = Math.sqrt(hz * hz2); ctx.fillStyle = center < 250 ? C.low : center < 4000 ? C.mid : C.high;
        const lo = Math.max(1, Math.floor(hz / sr * 4096)), hi = Math.min(this.freq.length - 1, Math.ceil(hz2 / sr * 4096)); let value = -100; for (let j = lo; j <= hi; j++) value = Math.max(value, this.freq[j]);
        const floor = h > 60 ? 18 : 0, amp = Math.max(0, (value + 100) / 100) * (h - floor - 4); ctx.fillRect(i / bars * w, h - floor - amp, Math.max(1, w / bars - (w / bars > 4 ? 2 : 1)), amp);
      }
      if (h > 60) { ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.fillStyle = C.muted; for (const hz of [20, 100, 1000, 10000]) ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : hz, Math.log(hz / 20) / Math.log(1000) * w + 2, h - 5); }
    }
  }
}
