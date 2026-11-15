// <audio> によるストリーミング再生 + 解析用の Web Audio グラフ。
// オシロ用 L/R と FFT 用の AnalyserNode は音量調整の手前から取るので、音量を下げても表示は変わらない。
export class Player extends EventTarget {
  constructor(resolve) {
    super();
    this.resolve = resolve; // 相対パス → URL
    this.audio = new Audio(); this.audio.preload = 'metadata';
    this.track = null; this.queue = []; this.ctx = null; this.left = null; this.right = null; this.analyser = null; this.gain = null;
    this.volume = 1; this.muted = false; this.repeat = 'off'; this.shuffle = false; this.error = null; this.playRequest = 0;
    const emit = name => () => this.dispatchEvent(new Event(name));
    for (const name of ['play', 'pause', 'playing', 'waiting', 'durationchange', 'seeked', 'loadedmetadata']) this.audio.addEventListener(name, emit('state'));
    this.audio.addEventListener('timeupdate', emit('time'));
    this.audio.addEventListener('ended', () => this.ended());
    this.audio.addEventListener('error', () => { if (!this.track) return; this.error = this.audio.error; this.dispatchEvent(new Event('state')); });
  }
  get playing() { return !this.audio.paused && !this.audio.ended; }
  get currentTime() { return this.audio.currentTime || 0; }
  get duration() { return Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : this.track?.duration || 0; }
  get sampleRate() { return this.ctx?.sampleRate || 48000; }

  ensureGraph() {
    if (this.ctx || this.graphFailed) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      const ctx = new Context(), source = ctx.createMediaElementSource(this.audio);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = .75;
      const splitter = ctx.createChannelSplitter(2); splitter.channelCountMode = 'explicit'; splitter.channelCount = 2; // モノラル音源も L/R に広げる
      const left = ctx.createAnalyser(), right = ctx.createAnalyser(); left.fftSize = right.fftSize = 4096;
      const gain = ctx.createGain();
      source.connect(analyser); source.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
      source.connect(gain); gain.connect(ctx.destination);
      Object.assign(this, { ctx, analyser, left, right, gain });
      this.audio.volume = 1; this.applyVolume();
    } catch { this.graphFailed = true; this.applyVolume(); }
  }
  applyVolume() {
    const value = this.muted ? 0 : this.volume;
    if (this.gain) this.gain.gain.value = value; else this.audio.volume = value;
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, value)); this.muted = false; this.applyVolume(); this.dispatchEvent(new Event('state')); }
  toggleMute() { this.muted = !this.muted; this.applyVolume(); this.dispatchEvent(new Event('state')); }

  // queue を渡すと「次へ / 前へ」の対象が入れ替わる
  async play(track, { queue, at } = {}) {
    const request = ++this.playRequest;
    if (queue) this.queue = queue;
    if (track && track.slug !== this.track?.slug) {
      this.track = track; this.error = null;
      this.audio.src = this.resolve(track.audio);
      this.dispatchEvent(new Event('track'));
      this.mediaSession();
    }
    if (!this.track) return;
    if (at !== undefined) this.seek(at);
    this.ensureGraph();
    try { await this.ctx?.resume(); if (request === this.playRequest) await this.audio.play(); } catch { /* 自動再生ブロックや中断。state イベントで表示は追従する */ }
  }
  pause() { this.playRequest++; this.audio.pause(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  seek(time) {
    const duration = this.duration; if (!duration || !Number.isFinite(time)) return;
    this.audio.currentTime = Math.max(0, Math.min(duration - .05, time)); this.dispatchEvent(new Event('time'));
  }
  neighbor(direction) {
    const list = this.queue, at = list.findIndex(t => t.slug === this.track?.slug);
    if (!list.length) return null;
    if (this.shuffle && list.length > 1) { let pick; do pick = list[Math.floor(Math.random() * list.length)]; while (pick.slug === this.track?.slug); return pick; }
    const next = at + direction;
    if (next >= 0 && next < list.length) return list[next];
    return this.repeat === 'all' ? list[(next + list.length) % list.length] : null;
  }
  next() { const track = this.neighbor(1); if (track) this.play(track); }
  prev() { if (this.currentTime > 3) return this.seek(0); const track = this.neighbor(-1); if (track) this.play(track); else this.seek(0); }
  ended() {
    if (this.repeat === 'one') { this.seek(0); this.play(); return; }
    const track = this.neighbor(1);
    if (track) this.play(track); else this.dispatchEvent(new Event('state'));
  }
  mediaSession() {
    if (!('mediaSession' in navigator) || !this.track) return;
    const t = this.track;
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: t.cover ? [{ src: this.resolve(t.cover) }] : [] });
    const set = (action, handler) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* 未対応の操作 */ } };
    set('play', () => this.play()); set('pause', () => this.pause());
    set('previoustrack', () => this.prev()); set('nexttrack', () => this.next());
    set('seekto', e => this.seek(e.seekTime));
  }
}
