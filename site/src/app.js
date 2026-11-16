import { Player } from './player.js';
import { WaveView, ScopeView, drawMini } from './views.js';
import { loadAnalysis, beatOffsetFor } from './analysis-client.js';
import { STRINGS } from './i18n.js';

const BASE = document.querySelector('meta[name="app-base"]').content;
const boot = JSON.parse(document.getElementById('boot').textContent);
const resolve = rel => BASE + rel;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(`otodana.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`otodana.${key}`, JSON.stringify(value)); } catch { /* 保存できない環境では毎回初期値 */ } }
};

let legacyFavs = [];
try { legacyFavs = JSON.parse(localStorage.getItem('archive-music:favorites') || '[]'); } catch {}

const state = {
  lang: store.get('lang', 'ja') === 'en' ? 'en' : 'ja',
  tracks: [], bySlug: new Map(),
  favs: new Set(store.get('favs', Array.isArray(legacyFavs) ? legacyFavs : [])),
  filters: { q: '', genre: '', tag: '', sort: 'new', fav: false, bpmMin: '', bpmMax: '' }
};
const t = (key, ...args) => { const value = STRINGS[state.lang][key] ?? STRINGS.ja[key] ?? key; return typeof value === 'function' ? value(...args) : value; };

const player = new Player(resolve);
player.volume = store.get('volume', 1); player.repeat = store.get('repeat', 'off'); player.shuffle = store.get('shuffle', false);
let view = null, dirty = true, barScope = null, barScopeMode = store.get('barScope', 'fft');

const ICON = { // Material Icons (Apache-2.0)
  play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>',
  prev: '<path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>', next: '<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>',
  shuffle: '<path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>',
  repeat: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>',
  volume: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>',
  muted: '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>',
  heart: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
  download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
  link: '<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>',
  share: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>',
  back: '<path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

const fmtTime = seconds => { if (!Number.isFinite(seconds) || seconds === null) return '–:––'; const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtBpm = bpm => (bpm ? (Math.abs(bpm - Math.round(bpm)) < .05 ? String(Math.round(bpm)) : bpm.toFixed(1)) : '—');
const fmtDb = value => (value > 0 ? `${(20 * Math.log10(value)).toFixed(1)} dBFS` : '—');
const trackHref = slug => `${BASE}t/${encodeURIComponent(slug)}/`;
const coverHtml = (track, cls = '') => track.cover
  ? `<img class="cover ${cls}" src="${esc(resolve(track.cover))}" alt="" loading="lazy" decoding="async">`
  : `<span class="cover cover-empty ${cls}" aria-hidden="true"></span>`;

// ---------------------------------------------------------------- routing
function route() {
  let pathname;
  try { pathname = decodeURIComponent(location.pathname); } catch { pathname = location.pathname; }
  const parts = (pathname.startsWith(BASE) ? pathname.slice(BASE.length) : '').split('/').filter(Boolean);
  if (!parts.length || parts[0] === 'index.html') return { name: 'home' };
  if (parts[0] === 't' && parts[1]) return { name: 'track', slug: parts[1] };
  if (parts[0] === 'about') return { name: 'about' };
  return { name: 'notfound' };
}
function navigate(href) { history.pushState(null, '', href); render(); scrollTo(0, 0); }
addEventListener('popstate', () => render());
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(link.href);
});

function render() {
  view?.destroy?.(); view = null;
  const current = route(), app = $('#app');
  renderTop(current);
  if (current.name === 'home') view = homeView(app);
  else if (current.name === 'track') view = trackView(app, current.slug);
  else if (current.name === 'about') view = aboutView(app);
  else { app.innerHTML = `<section class="empty"><h1>${esc(t('notFound'))}</h1><p><a class="button" href="${BASE}" data-link>${esc(t('back'))}</a></p></section>`; document.title = boot.site.title; }
  syncPlaying(); dirty = true;
}

function renderTop(current) {
  document.documentElement.lang = state.lang;
  $('#top').innerHTML = `
    <a class="brand" href="${BASE}" data-link><svg viewBox="0 0 32 32" aria-hidden="true"><g stroke-linecap="round" stroke-width="3"><path d="M7 13v6" stroke="#fdac64"/><path d="M13 8v16" stroke="#59c6da"/><path d="M19 11v10" stroke="#b49cff"/><path d="M25 14v4" stroke="#c3f96b"/></g></svg><span>${esc(boot.site.title)}</span></a>
    <nav>
      <a href="${BASE}" data-link ${current.name === 'home' || current.name === 'track' ? 'aria-current="page"' : ''}>${esc(t('tracks'))}</a>
      <a href="${BASE}about/" data-link ${current.name === 'about' ? 'aria-current="page"' : ''}>${esc(t('about'))}</a>
      <a href="${BASE}studio/">Studio</a>
      <button class="lang" id="lang" aria-label="Language">${state.lang === 'ja' ? 'EN' : 'JP'}</button>
    </nav>`;
  $('#lang').onclick = () => { state.lang = state.lang === 'ja' ? 'en' : 'ja'; store.set('lang', state.lang); render(); renderBar(); };
}

// ---------------------------------------------------------------- home
function visibleTracks() {
  const f = state.filters, q = f.q.trim().toLowerCase(), min = Number(f.bpmMin), max = Number(f.bpmMax);
  const list = state.tracks.filter(track => {
    if (q && ![track.title, track.artist, track.album, track.genre, ...track.tags, ...(track.generationTools || [])].join('\n').toLowerCase().includes(q)) return false;
    if (f.genre && track.genre !== f.genre) return false;
    if (f.tag && !track.tags.includes(f.tag)) return false;
    if (f.fav && !state.favs.has(track.slug)) return false;
    if (min && !(track.bpm >= min)) return false;
    if (max && !(track.bpm <= max)) return false;
    return true;
  });
  const by = {
    new: (a, b) => (b.date || '').localeCompare(a.date || ''), old: (a, b) => (a.date || '').localeCompare(b.date || ''),
    title: (a, b) => a.title.localeCompare(b.title, state.lang), bpmUp: (a, b) => (a.bpm || 1e9) - (b.bpm || 1e9),
    bpmDown: (a, b) => (b.bpm || 0) - (a.bpm || 0), long: (a, b) => (b.duration || 0) - (a.duration || 0)
  }[f.sort];
  return list.sort((a, b) => by(a, b) || a.title.localeCompare(b.title));
}

function rowHtml(track) {
  const fav = state.favs.has(track.slug);
  const sub = [track.artist, track.genre, (track.generationTools || []).join(' / ')].filter(Boolean).map(esc).join(' · ');
  return `<li class="row" data-slug="${esc(track.slug)}">
    <button class="row-play" data-play="${esc(track.slug)}" aria-label="${esc(t('play'))}: ${esc(track.title)}">${coverHtml(track)}<span class="row-play-icon">${icon('play')}</span></button>
    <div class="row-main">
      <a class="row-title" href="${trackHref(track.slug)}" data-link>${esc(track.title)}${track.demo ? ' <span class="badge">DEMO</span>' : ''}</a>
      <div class="row-sub">${sub}${track.tags.length ? `<span class="row-tags">${track.tags.map(tag => `#${esc(tag)}`).join(' ')}</span>` : ''}</div>
    </div>
    <canvas class="row-wave" data-wave="${esc(track.slug)}" aria-hidden="true"></canvas>
    <div class="row-bpm"><b>${fmtBpm(track.bpm)}</b><span>BPM</span></div>
    <div class="row-time">${fmtTime(track.duration)}</div>
    <button class="row-fav" data-fav="${esc(track.slug)}" aria-pressed="${fav}" aria-label="${esc(t(fav ? 'removeFav' : 'addFav'))}">${icon('heart')}</button>
  </li>`;
}

function homeView(app) {
  document.title = boot.site.title;
  const params = new URLSearchParams(location.search);
  if (params.has('tag') || params.has('genre') || params.has('q')) Object.assign(state.filters, { tag: params.get('tag') || '', genre: params.get('genre') || '', q: params.get('q') || '' });
  const f = state.filters;
  if (!state.tracks.length) {
    app.innerHTML = `<section class="empty"><h1>${esc(t('emptyTitle'))}</h1><p>${esc(t('emptyBody'))}</p><pre>_inbox/My Song.mp3\n_inbox/My Song.jpg   (optional cover)\n_inbox/My Song.md    (optional info)</pre></section>`;
    return {};
  }
  const genres = [...new Set(state.tracks.map(x => x.genre).filter(Boolean))].sort();
  const tagCount = new Map(); for (const track of state.tracks) for (const tag of track.tags) tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
  const tags = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24);
  const tagline = boot.site.tagline?.[state.lang] || boot.site.tagline?.ja || '';
  const total = state.tracks.reduce((sum, x) => sum + (x.duration || 0), 0);
  app.innerHTML = `
    <section class="hero">
      <h1>${esc(boot.site.title)}</h1>
      ${tagline ? `<p>${esc(tagline)}</p>` : ''}
      <p class="hero-stats">${esc(t('count', state.tracks.length))} · ${Math.floor(total / 60)} min</p>
    </section>
    <section class="filters" aria-label="filters">
      <input id="q" type="search" placeholder="${esc(t('search'))}" value="${esc(f.q)}" aria-label="${esc(t('search'))}">
      <select id="genre" aria-label="genre"><option value="">${esc(t('allGenres'))}</option>${genres.map(g => `<option ${g === f.genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <select id="sort" aria-label="sort">${[['new', 'sortNew'], ['old', 'sortOld'], ['title', 'sortTitle'], ['bpmUp', 'sortBpmUp'], ['bpmDown', 'sortBpmDown'], ['long', 'sortLong']].map(([v, k]) => `<option value="${v}" ${v === f.sort ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select>
      <label class="bpm-range">BPM <input id="bpmMin" type="number" inputmode="numeric" min="20" max="400" placeholder="min" value="${esc(f.bpmMin)}" aria-label="BPM min"><span>–</span><input id="bpmMax" type="number" inputmode="numeric" min="20" max="400" placeholder="max" value="${esc(f.bpmMax)}" aria-label="BPM max"></label>
      <button id="favOnly" class="icon-button" aria-pressed="${f.fav}" aria-label="${esc(t('favOnly'))}" title="${esc(t('favOnly'))}">${icon('heart')}</button>
    </section>
    ${tags.length ? `<div class="tag-row">${tags.map(([tag]) => `<button class="chip" data-tag="${esc(tag)}" aria-pressed="${tag === f.tag}">#${esc(tag)}</button>`).join('')}</div>` : ''}
    <p class="list-count" id="count"></p>
    <ol class="list" id="list"></ol>`;

  let list = [], currentCanvas = null;
  const drawRows = () => { for (const canvas of $$('canvas[data-wave]', app)) drawMini(canvas, state.bySlug.get(canvas.dataset.wave)?.mini, null); currentCanvas = null; dirty = true; };
  const update = () => {
    list = visibleTracks();
    $('#count').textContent = t('count', list.length);
    $('#list').innerHTML = list.length ? list.map(rowHtml).join('') : `<li class="no-match">${esc(t('noMatch'))} <button id="clear">${esc(t('clear'))}</button></li>`;
    for (const chip of $$('.chip[data-tag]', app)) chip.setAttribute('aria-pressed', chip.dataset.tag === f.tag);
    drawRows(); syncPlaying();
  };
  const bind = (id, key, event = 'input') => $(`#${id}`).addEventListener(event, e => { f[key] = e.target.value; update(); });
  bind('q', 'q'); bind('genre', 'genre', 'change'); bind('sort', 'sort', 'change'); bind('bpmMin', 'bpmMin'); bind('bpmMax', 'bpmMax');
  $('#favOnly').onclick = e => { f.fav = !f.fav; e.currentTarget.setAttribute('aria-pressed', f.fav); update(); };
  app.onclick = event => {
    const chip = event.target.closest('[data-tag]');
    if (chip) { f.tag = f.tag === chip.dataset.tag ? '' : chip.dataset.tag; update(); return; }
    if (event.target.closest('#clear')) { Object.assign(f, { q: '', genre: '', tag: '', fav: false, bpmMin: '', bpmMax: '' }); render(); return; }
    handleCommon(event, () => list);
    if (f.fav && event.target.closest("[data-fav]")) update();
  };
  const resize = new ResizeObserver(drawRows); resize.observe($('#list'));
  update();
  return {
    destroy() { resize.disconnect(); app.onclick = null; },
    live() {
      // 再生中の行だけ、進行状況つきで描き直す
      const slug = player.track?.slug; if (!slug) return;
      if (!currentCanvas || currentCanvas.dataset.wave !== slug) { if (currentCanvas) drawMini(currentCanvas, state.bySlug.get(currentCanvas.dataset.wave)?.mini, null); currentCanvas = $$('canvas[data-wave]', app).find(c => c.dataset.wave === slug) || null; }
      if (currentCanvas && player.duration) drawMini(currentCanvas, player.track.mini, player.currentTime / player.duration);
    }
  };
}

// 一覧・関連曲で共通のクリック処理（再生 / お気に入り）
function handleCommon(event, queue) {
  const play = event.target.closest('[data-play]');
  if (play) {
    const track = state.bySlug.get(play.dataset.play) || (boot.track?.slug === play.dataset.play ? boot.track : null);
    if (!track) return;
    if (player.track?.slug === track.slug) player.toggle(); else player.play(track, { queue: queue() });
    return;
  }
  const fav = event.target.closest('[data-fav]');
  if (fav) {
    const slug = fav.dataset.fav, on = !state.favs.has(slug);
    if (on) state.favs.add(slug); else state.favs.delete(slug);
    store.set('favs', [...state.favs]);
    for (const button of $$(`[data-fav="${CSS.escape(slug)}"]`)) { button.setAttribute('aria-pressed', on); button.setAttribute('aria-label', t(on ? 'removeFav' : 'addFav')); }
  }
}

// ---------------------------------------------------------------- track page
function trackView(app, slug) {
  const track = state.bySlug.get(slug) || (boot.track?.slug === slug ? boot.track : null);
  if (!track) { app.innerHTML = `<section class="empty"><h1>${esc(t('notFound'))}</h1><p><a class="button" href="${BASE}" data-link>${esc(t('back'))}</a></p></section>`; return {}; }
  document.title = `${track.title}${track.artist ? ` — ${track.artist}` : ''} | ${boot.site.title}`;
  const isCurrent = () => player.track?.slug === track.slug;
  const related = state.tracks.filter(x => x.slug !== track.slug)
    .map(x => ({ x, score: x.tags.filter(tag => track.tags.includes(tag)).length * 2 + (x.genre && x.genre === track.genre ? 3 : 0) + (x.bpm && track.bpm && Math.abs(x.bpm - track.bpm) <= 6 ? 1 : 0) }))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(r => r.x);
  const fav = state.favs.has(track.slug);
  const shareUrl = location.origin + trackHref(track.slug);
  const fact = (label, value, id = '') => `<div><dt>${esc(label)}</dt><dd ${id ? `id="${id}"` : ''}>${value}</dd></div>`;

  app.innerHTML = `
    <article class="track">
      <a class="back" href="${BASE}" data-link>${icon('back')}${esc(t('back'))}</a>
      <header class="track-head">
        ${coverHtml(track, 'cover-large')}
        <div class="track-title">
          <p class="eyebrow">${[track.genre, track.date].filter(Boolean).map(esc).join(' · ')}${track.demo ? ' <span class="badge">DEMO</span>' : ''}</p>
          <h1>${esc(track.title)}</h1>
          ${track.artist ? `<p class="artist">${esc(track.artist)}${track.album ? ` — ${esc(track.album)}` : ''}</p>` : ''}
          <div class="actions">
            <button class="primary big-play" data-play="${esc(track.slug)}">${icon('play')}<span>${esc(t('play'))}</span></button>
            <button class="icon-button row-fav" data-fav="${esc(track.slug)}" aria-pressed="${fav}" aria-label="${esc(t(fav ? 'removeFav' : 'addFav'))}">${icon('heart')}</button>
            ${track.download ? `<a class="button" href="${esc(resolve(track.download))}" download="${esc(track.downloadName)}">${icon('download')}${esc(t('download'))} <small>${esc(track.format)}</small></a>` : ''}
            ${track.midi ? `<a class="button" href="${esc(resolve(track.midi))}" download="${esc(track.midiName)}">>${icon('download')}${esc(t('midiDownload'))} <small>MID</small></a>` : ''}
            <button class="icon-button" id="share" aria-label="${esc(t('share'))}" title="${esc(t('share'))}">${icon('share')}</button>
            <button class="icon-button" id="copy" aria-label="${esc(t('copyLink'))}" title="${esc(t('copyLink'))}">${icon('link')}</button>
          </div>
          ${track.tags.length ? `<div class="tag-row">${track.tags.map(tag => `<a class="chip" href="${BASE}?tag=${encodeURIComponent(tag)}" data-link>#${esc(tag)}</a>`).join('')}</div>` : ''}
        </div>
        <dl class="facts">
          ${fact('BPM', `<b id="factBpm">${fmtBpm(track.bpm)}</b>`)}
          ${fact(t('duration'), fmtTime(track.duration), 'factDuration')}
          ${track.key ? fact(t('key'), esc(track.key)) : ''}
          ${fact(t('format'), esc(track.format), 'factFormat')}
          ${fact(t('peak'), '—', 'factPeak')}
          ${fact(t('rms'), '—', 'factRms')}
          ${fact(t('license'), esc(track.license))}
          ${track.generationTools?.length ? fact(t('generationTools'), esc(track.generationTools.join(' / '))) : ''}
        </dl>
      </header>

      <section class="panel">
        <div class="panel-head">
          <h2>${esc(t('waveform'))}</h2>
          <span class="legend"><i style="background:var(--low)"></i>LOW <i style="background:var(--mid)"></i>MID <i style="background:var(--high)"></i>HIGH</span>
          <span class="readout" id="clock">0:00.000</span>
          <span class="panel-tools">
            <label class="check"><input type="checkbox" id="grid" checked> ${esc(t('beatGrid'))}</label>
            <button id="zoomOut" aria-label="${esc(t('zoomOut'))}">−</button><span class="readout" id="zoom">×1</span><button id="zoomIn" aria-label="${esc(t('zoomIn'))}">＋</button>
          </span>
        </div>
        <canvas id="wave" class="wave" tabindex="0" aria-label="${esc(t('waveform'))}"></canvas>
        <p class="hint" id="waveStatus">${esc(t('waveHint'))}</p>
      </section>

      <div class="scopes">
        <section class="panel">
          <div class="panel-head"><h2>${esc(t('oscilloscope'))}</h2><span class="legend"><i style="background:var(--mid)"></i>L <i style="background:var(--high)"></i>R</span></div>
          <div class="scope-wrap"><canvas id="osc" class="scope"></canvas><span class="scope-idle">${esc(t('scopeIdle'))}</span></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>${esc(t('spectrum'))}</h2><span class="legend"><i style="background:var(--low)"></i>&lt;250Hz <i style="background:var(--mid)"></i>250Hz–4k <i style="background:var(--high)"></i>4k+</span></div>
          <div class="scope-wrap"><canvas id="fft" class="scope"></canvas><span class="scope-idle">${esc(t('scopeIdle'))}</span></div>
        </section>
      </div>

      <section class="panel" id="tempo"><div class="panel-head"><h2>${esc(t('tempo'))}</h2></div><div id="tempoBody" class="tempo-body"><p class="hint">…</p></div></section>

      ${track.descriptionHtml ? `<section class="description"><h2>${esc(t('description'))}</h2>${track.descriptionHtml}</section>` : ''}
      ${related.length ? `<section class="related"><h2>${esc(t('related'))}</h2><ol class="list">${related.map(rowHtml).join('')}</ol></section>` : ''}
    </article>`;

  const wave = new WaveView($('#wave'), {
    duration: () => (isCurrent() ? player.duration : track.duration || analysis?.duration || 0),
    time: () => (isCurrent() ? player.currentTime : null),
    playing: () => isCurrent() && player.playing,
    seek: time => { if (isCurrent()) player.seek(time); else player.play(track, { queue: queueFor(track), at: time }); }
  });
  const osc = new ScopeView($('#osc'), scopeSource(isCurrent), 'osc'), fft = new ScopeView($('#fft'), scopeSource(isCurrent), 'fft');
  let analysis = null, destroyed = false;
  const baseTempo = { bpm: track.bpm, offset: 0 };
  wave.onzoom = zoom => { $('#zoom').textContent = `×${zoom >= 10 ? Math.round(zoom) : Number(zoom.toFixed(1))}`; };
  $('#zoomIn').onclick = () => wave.setZoom(wave.zoom * 2); $('#zoomOut').onclick = () => wave.setZoom(wave.zoom / 2);
  $('#grid').onchange = e => { wave.grid = e.target.checked; wave.draw(); };
  $('#share').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: track.title, text: `${track.title}${track.artist ? ` — ${track.artist}` : ''}`, url: shareUrl }); } catch { /* キャンセル */ } }
    else open(`https://x.com/intent/post?text=${encodeURIComponent(`${track.title}${track.artist ? ` — ${track.artist}` : ''}`)}&url=${encodeURIComponent(shareUrl)}`, '_blank', 'noopener');
  };
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(shareUrl); toast(t('copied')); } catch { prompt(t('copyLink'), shareUrl); } };
  app.onclick = event => handleCommon(event, () => queueFor(track));

  const setTempo = (bpm, offset) => { wave.setTempo(bpm, offset); const value = $('.tempo-value', app); if (value) value.textContent = fmtBpm(bpm); for (const b of $$('[data-bpm]', app)) b.setAttribute('aria-pressed', Math.abs(Number(b.dataset.bpm) - bpm) < .01 && Math.abs(Number(b.dataset.offset) - offset) < 1e-6); };
  const renderTempo = () => {
    const a = analysis, body = $('#tempoBody');
    const button = c => `<button class="candidate" data-bpm="${c.bpm}" data-offset="${c.beatOffset || 0}" aria-pressed="false"><b>${fmtBpm(c.bpm)}</b><small>${Math.round((c.confidence || 0) * 100)}%</small></button>`;
    const top = a?.tempoCandidates?.[0];
    const source = track.bpmSource === 'manual' ? `${t('bpmManual')}${a?.bpm ? ` · ${t('autoValue', fmtBpm(a.bpm))}` : ''}` : baseTempo.bpm ? `${t('bpmAuto')}${top?.primarySupport ? ` · ${t('agree', top.primarySupport)}` : ''}` : t('bpmUnknown');
    const names = { interval: 'ioi', correlation: 'acf', comb: 'comb' };
    body.innerHTML = `
      <div class="tempo-main"><b class="tempo-value">${fmtBpm(baseTempo.bpm)}</b><span>BPM</span><p>${esc(source)}</p><button id="tempoReset" hidden>${esc(t('resetTempo'))}</button></div>
      <form id="manualTempo" class="manual-tempo"><label>${state.lang === 'ja' ? 'グリッドのBPM' : 'Grid BPM'} <input id="manualBpm" aria-label="Manual BPM" type="number" min="20" max="400" step="0.1" required value="${baseTempo.bpm || ''}"></label><button type="submit">${state.lang === 'ja' ? '適用' : 'Apply'}</button></form>
      ${a ? `<div class="engines">
        <div class="engine"><h3>${esc(t('consensus'))}</h3><div>${a.tempoCandidates?.length ? a.tempoCandidates.map(button).join('') : `<span class="hint">${esc(t('noCandidate'))}</span>`}</div></div>
        ${(a.engines || []).map(e => `<div class="engine"><h3>${esc(t(names[e.id] || e.id))} <small>${esc(e.short || '')}</small></h3><div>${e.candidates.length ? e.candidates.map(button).join('') : `<span class="hint">${esc(t('noCandidate'))}</span>`}</div></div>`).join('')}
      </div><p class="hint">${esc(t('engineHint'))}</p>` : ''}`;
    $('#manualTempo').onsubmit = event => { event.preventDefault(); const bpm = Number($('#manualBpm').value); if (bpm >= 20 && bpm <= 400) { setTempo(bpm, beatOffsetFor(bpm, analysis)); $('#tempoReset').hidden = false; } };
    body.onclick = event => {
      const pick = event.target.closest('[data-bpm]');
      if (pick) { setTempo(Number(pick.dataset.bpm), Number(pick.dataset.offset)); $('#tempoReset').hidden = false; }
      if (event.target.closest('#tempoReset')) { setTempo(baseTempo.bpm, baseTempo.offset); $('#tempoReset').hidden = true; }
    };
    setTempo(baseTempo.bpm, baseTempo.offset);
  };
  renderTempo();

  loadAnalysis(track, resolve, progress => { if (!destroyed) $('#waveStatus').textContent = t('analyzing', Math.round(progress * 100)); }).then(result => {
    if (destroyed) return;
    analysis = result;
    if (!track.bpm && result.bpm) { baseTempo.bpm = result.bpm; $('#factBpm').textContent = fmtBpm(result.bpm); } // ブラウザ内解析で初めて分かった BPM
    baseTempo.offset = track.bpmSource === 'manual' ? beatOffsetFor(track.bpm, result) : result.beatOffset || 0;
    wave.setData(result.wave);
    $('#factPeak').textContent = fmtDb(result.samplePeak); $('#factRms').textContent = fmtDb(result.rms);
    if (!track.duration && result.duration) $('#factDuration').textContent = fmtTime(result.duration);
    if (result.sampleRate) $('#factFormat').textContent = `${track.format} · ${(result.sampleRate / 1000).toFixed(1).replace(/\.0$/, '')} kHz${result.channels === 1 ? ' · mono' : ''}`;
    $('#waveStatus').textContent = t('waveHint');
    renderTempo();
  }).catch(error => { if (!destroyed) $('#waveStatus').textContent = t(error.message === 'too-large' ? 'analysisTooLarge' : 'analysisFailed'); });

  const clock = $('#clock');
  const live = () => {
    wave.follow(); wave.draw(); osc.draw(); fft.draw();
    const time = isCurrent() ? player.currentTime : 0, ms = Math.floor(time * 1000);
    clock.textContent = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    app.classList.toggle('scopes-live', isCurrent() && player.playing);
  };
  const resize = new ResizeObserver(() => { dirty = true; for (const canvas of $$('canvas[data-wave]', app)) drawMini(canvas, state.bySlug.get(canvas.dataset.wave)?.mini, null); }); resize.observe($('#osc'));
  return { live, destroy() { destroyed = true; wave.destroy(); resize.disconnect(); app.onclick = null; app.classList.remove('scopes-live'); } };
}

// このトラックを再生しているときだけ、スコープに信号を流す
function scopeSource(isCurrent) {
  return { get playing() { return isCurrent() && player.playing; }, get left() { return player.left; }, get right() { return player.right; }, get analyser() { return player.analyser; }, get sampleRate() { return player.sampleRate; } };
}
function queueFor(track) {
  if (player.queue.some(x => x.slug === track.slug)) return player.queue;
  return state.bySlug.has(track.slug) ? state.tracks : [track];
}

// ---------------------------------------------------------------- about
function aboutView(app) {
  document.title = `${t('about')} — ${boot.site.title}`;
  const links = boot.site.links || [];
  app.innerHTML = `<article class="about">
    <h1>${esc(t('about'))}</h1>
    ${boot.site.about ? `<section class="description">${boot.site.about}</section>` : ''}
    <section class="description"><h2>${esc(t('aboutHow'))}</h2><p>${esc(t('aboutBody'))}</p>
      <p><a href="https://github.com/Xenoah/dt-cue_precision-media-player" target="_blank" rel="noopener noreferrer">dt-cue — Precision Media Player</a></p></section>
    <section class="description"><h2>${esc(t('links'))}</h2><ul>
      ${links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></li>`).join('')}
      <li><a href="${BASE}rss.xml">${esc(t('rss'))}</a></li></ul></section>
  </article>`;
  return {};
}

// ---------------------------------------------------------------- player bar
function renderBar() {
  const bar = $('#bar'), track = player.track;
  if (!track) { bar.hidden = true; document.body.classList.remove('has-bar'); return; }
  bar.hidden = false; document.body.classList.add('has-bar');
  bar.innerHTML = `
    <a class="bar-track" href="${trackHref(track.slug)}" data-link>${coverHtml(track)}<span><b>${esc(track.title)}</b><small>${esc(track.artist || '')}</small></span></a>
    <div class="bar-controls">
      <button class="icon-button" id="barPrev" aria-label="${esc(t('prev'))}">${icon('prev')}</button>
      <button class="icon-button bar-play" id="barPlay" aria-label="${esc(t('play'))}">${icon('play')}</button>
      <button class="icon-button" id="barNext" aria-label="${esc(t('next'))}">${icon('next')}</button>
    </div>
    <span class="bar-clock" id="barTime">0:00</span>
    <canvas class="bar-wave" id="barWave" role="slider" tabindex="0" aria-label="seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></canvas>
    <span class="bar-clock" id="barDuration">${fmtTime(player.duration)}</span>
    <span class="bar-bpm"><b>${fmtBpm(track.bpm)}</b> BPM</span>
    <canvas class="bar-scope" id="barScope" role="button" tabindex="0" aria-label="OSC / FFT" title="OSC / FFT"></canvas>
    <div class="bar-extra">
      <button class="icon-button" id="barShuffle" aria-pressed="${player.shuffle}" aria-label="${esc(t('shuffle'))}" title="${esc(t('shuffle'))}">${icon('shuffle')}</button>
      <button class="icon-button" id="barRepeat" aria-pressed="${player.repeat !== 'off'}" aria-label="${esc(t('repeat'))}" title="${esc(t('repeat'))}">${icon('repeat')}<i class="repeat-one" ${player.repeat === 'one' ? '' : 'hidden'}>1</i></button>
      <button class="icon-button" id="barMute" aria-label="${esc(t('mute'))}">${icon('volume')}</button>
      <input id="barVolume" type="range" min="0" max="1" step="0.01" value="${player.volume}" aria-label="${esc(t('volume'))}">
    </div>`;
  $('#barPrev').onclick = () => player.prev(); $('#barNext').onclick = () => player.next(); $('#barPlay').onclick = () => player.toggle();
  $('#barShuffle').onclick = e => { player.shuffle = !player.shuffle; store.set('shuffle', player.shuffle); e.currentTarget.setAttribute('aria-pressed', player.shuffle); };
  $('#barRepeat').onclick = e => {
    player.repeat = { off: 'all', all: 'one', one: 'off' }[player.repeat]; store.set('repeat', player.repeat);
    e.currentTarget.setAttribute('aria-pressed', player.repeat !== 'off'); $('.repeat-one', e.currentTarget).hidden = player.repeat !== 'one';
  };
  $('#barMute').onclick = () => player.toggleMute();
  $('#barVolume').oninput = e => { player.setVolume(Number(e.target.value)); store.set('volume', player.volume); };
  const waveCanvas = $('#barWave'); let dragging = false;
  const seek = e => { const r = waveCanvas.getBoundingClientRect(); player.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * player.duration); };
  waveCanvas.onpointerdown = e => { waveCanvas.setPointerCapture(e.pointerId); dragging = true; seek(e); };
  waveCanvas.onpointermove = e => { if (dragging) seek(e); };
  waveCanvas.onpointerup = waveCanvas.onpointercancel = () => { dragging = false; };
  waveCanvas.onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); player.seek(player.currentTime + (e.key === 'ArrowRight' ? 5 : -5)); } };
  const scopeCanvas = $('#barScope');
  barScope = new ScopeView(scopeCanvas, player, barScopeMode);
  const flip = () => { barScopeMode = barScope.mode = barScope.mode === 'osc' ? 'fft' : 'osc'; store.set('barScope', barScopeMode); dirty = true; };
  scopeCanvas.onclick = flip; scopeCanvas.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); flip(); } };
  syncPlaying(); dirty = true;
}

function syncPlaying() {
  const slug = player.track?.slug, playing = player.playing;
  for (const row of $$('.row')) { const current = row.dataset.slug === slug; row.classList.toggle('is-current', current); const b = $('.row-play-icon', row); if (b) b.innerHTML = icon(current && playing ? 'pause' : 'play'); }
  const big = $('.big-play');
  if (big) { const on = big.dataset.play === slug && playing; big.innerHTML = `${icon(on ? 'pause' : 'play')}<span>${esc(t(on ? 'pause' : 'play'))}</span>`; }
  const barPlay = $('#barPlay');
  if (barPlay) { barPlay.innerHTML = icon(playing ? 'pause' : 'play'); barPlay.setAttribute('aria-label', t(playing ? 'pause' : 'play')); }
  const mute = $('#barMute'); if (mute) mute.innerHTML = icon(player.muted || player.volume === 0 ? 'muted' : 'volume');
  const duration = $('#barDuration'); if (duration) duration.textContent = fmtTime(player.duration);
}

let toastTimer;
function toast(message) { const el = $('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 1800); }

player.addEventListener('track', renderBar);
player.addEventListener('state', () => { syncPlaying(); dirty = true; if (player.error) { toast(t('error')); player.error = null; } });
player.addEventListener('time', () => { dirty = true; });

function frame() {
  requestAnimationFrame(frame);
  if (!player.playing && !dirty) return;
  dirty = false;
  if (player.track) {
    const time = $('#barTime'), waveCanvas = $('#barWave');
    if (time) time.textContent = fmtTime(player.currentTime);
    if (waveCanvas) { const progress = player.duration ? player.currentTime / player.duration : 0; drawMini(waveCanvas, player.track.mini, progress); waveCanvas.setAttribute('aria-valuenow', Math.round(progress * 100)); }
    barScope?.draw();
  }
  view?.live?.();
}

addEventListener('keydown', event => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest?.('input, select, textarea, button, a, [contenteditable]')) return;
  if (!player.track) return;
  if (event.key === ' ') { event.preventDefault(); player.toggle(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); player.seek(player.currentTime - 5); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); player.seek(player.currentTime + 5); }
  else if (event.key.toLowerCase() === 'm') player.toggleMute();
});

async function start() {
  try {
    const response = await fetch(`${BASE}data/tracks.json?v=${boot.build}`);
    if (response.ok) state.tracks = (await response.json()).tracks;
  } catch { /* 一覧が取れなくても、曲ページ単体は boot.track で表示できる */ }
  state.bySlug = new Map(state.tracks.map(track => [track.slug, track]));
  const oldSlug = new URLSearchParams(location.hash.slice(1)).get('track');
  if (oldSlug && state.bySlug.has(oldSlug)) history.replaceState(null, '', trackHref(oldSlug));
  render();
  requestAnimationFrame(frame);
}
start();
