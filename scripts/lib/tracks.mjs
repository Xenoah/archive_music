// content/tracks/{slug}/ を読み、検証済みのトラック一覧にする。
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ANALYSIS_FILE, AUDIO_EXTENSIONS, AUTO_COVER_FILE, DATE_RE, IMAGE_EXTENSIONS, MIDI_EXTENSIONS, SLUG_RE, STATUSES, TRACKS_DIR
} from "./constants.mjs";
import { parseFrontMatter } from "./frontmatter.mjs";
import { toList } from "./util.mjs";
import { filesIn, validateMeta, MAX_BYTES, probe as strictProbe } from '../lib.mjs';
import { stat } from 'node:fs/promises';

export async function loadTracks(config) {
  if (!existsSync(TRACKS_DIR)) return [];
  const entries = await readdir(TRACKS_DIR, { withFileTypes: true });
  if (entries.some(e => e.isSymbolicLink())) throw new Error('Track symlinks are not accepted');
  const tracks = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    tracks.push(await loadTrack(entry.name, config));
  }
  return tracks;
}

export async function loadTrack(slug, config) {
  const dir = path.join(TRACKS_DIR, slug);
  const track = { slug, dir, errors: [], warnings: [] };
  await filesIn(dir); // Reject symlinks before reading metadata or media.
  if (!SLUG_RE.test(slug)) track.errors.push("フォルダ名(slug)に使えない文字があります。文字・数字・-・_ のみ使えます");
  const files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
  const markdown = path.join(dir, `${slug}.md`);
  let data = {}, body = "";
  const legacy = path.join(dir, 'track.json');
  if (existsSync(legacy)) { data = JSON.parse(await readFile(legacy, 'utf8')); body = data.description || ''; }
  if (existsSync(markdown)) { const md = parseFrontMatter(await readFile(markdown, 'utf8')); data = { ...data, ...md.data }; body = md.body; }
  else if (!existsSync(legacy)) track.errors.push(`${slug}.md または track.json が必要です`);
  track.generationTools = [];
  try {
    const metadata = validateMeta({...data, artist:data.artist || config.author || 'Xenoah', tags:toList(data.tags), bpm:data.bpm === '' ? null : data.bpm});
    track.generationTools = metadata.generationTools;
  } catch(error) { track.errors.push(error.message); }
  if (data.slug && data.slug !== slug) track.errors.push('Metadata slug must match its folder');
  track.demo = data.demo === true;

  const audioFiles = files.filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (data.audio) {
    if (audioFiles.includes(String(data.audio))) track.audioFile = String(data.audio);
    else if (data.status !== "draft") track.errors.push(`audio: "${data.audio}" が見つかりません`);
  } else if (audioFiles.length === 1) track.audioFile = audioFiles[0];
  else if (audioFiles.length === 0 && data.status !== "draft") track.errors.push("音声ファイルがありません");
  else if (audioFiles.length > 1) track.errors.push(`音声ファイルが複数あります (${audioFiles.join(", ")})。Front Matter の audio: で1つ指定してください`);

  const images = files.filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (data.cover) {
    if (images.includes(String(data.cover))) track.coverFile = String(data.cover);
    else track.errors.push(`cover: "${data.cover}" が見つかりません`);
  } else {
    track.coverFile = images.find((name) => /^cover\./i.test(name)) || images.find((name) => name !== AUTO_COVER_FILE) || null;
  }
  track.coverAuto = false;
  if (!track.coverFile && files.includes(AUTO_COVER_FILE)) { track.coverFile = AUTO_COVER_FILE; track.coverAuto = true; }

  const midiFiles = files.filter((name) => MIDI_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (data.midi) {
    if (midiFiles.includes(String(data.midi))) track.midiFile = String(data.midi);
    else track.errors.push(`midi: "${data.midi}" が見つかりません`);
  } else {
    track.midiFile = midiFiles.find((name) => /^midi\./i.test(name)) || (midiFiles.length === 1 ? midiFiles[0] : null);
  }

  track.title = String(data.title ?? "").trim();
  if (!track.title) track.errors.push("title が必要です");
  track.artist = String(data.artist ?? "").trim() || config.author || "";
  track.album = String(data.album ?? "").trim();
  track.genre = String(data.genre ?? "").trim();
  track.tags = toList(data.tags);
  track.key = String(data.key ?? "").trim();
  track.license = String(data.license ?? "").trim() || config.defaultLicense;
  track.status = String(data.status ?? "public").trim();
  if (!STATUSES.has(track.status)) track.errors.push(`status "${track.status}" は無効です (public / draft / hidden)`);
  track.download = typeof data.download === "boolean" ? data.download : Boolean(config.defaultDownload);

  for (const key of ["createdAt", "uploadedAt", "updatedAt"]) {
    const value = data[key] === undefined || data[key] === null ? "" : String(data[key]).trim();
    if (value && (!DATE_RE.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) track.errors.push(`${key} は YYYY-MM-DD で書いてください ("${value}")`);
    track[key] = value;
  }

  track.bpmManual = null;
  if (data.bpm !== undefined && data.bpm !== null && data.bpm !== "") {
    const bpm = Number(data.bpm);
    if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 400) track.bpmManual = bpm;
    else track.errors.push(`bpm "${data.bpm}" は 20〜400 の数値で書いてください`);
  }
  track.body = body;
  track.data = data;
  if (track.audioFile && track.status !== 'draft') {
    const audioPath = path.join(dir, track.audioFile);
    if ((await stat(audioPath)).size > MAX_BYTES) track.errors.push('Audio exceeds 95 MiB');
    if (process.env.FFMPEG_PATH !== 'none') {
      try {
        const info = strictProbe(audioPath), duration = Number(info.format.duration);
        if (!info.streams.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0 || duration > 1200) track.errors.push('Audio must be at most 20 minutes');
      } catch(error) { track.errors.push(error.message); }
    }
  }

  track.analysis = null;
  const analysisPath = path.join(dir, ANALYSIS_FILE);
  if (existsSync(analysisPath)) {
    try { track.analysis = JSON.parse(await readFile(analysisPath, "utf8")); }
    catch { track.warnings.push(`${ANALYSIS_FILE} が壊れています。npm run analyze で作り直してください`); }
  }
  if (track.status === "draft") track.warnings.push("status が draft です");
  if (!track.coverFile) track.warnings.push("カバー画像がありません（解析後に自動生成されます）");
  return track;
}

export function reportTracks(tracks) {
  let errors = 0, warnings = 0;
  for (const track of tracks) {
    for (const message of track.errors) { console.error(`[ERROR] ${track.slug}: ${message}`); errors++; }
    for (const message of track.warnings) { console.warn(`[WARN]  ${track.slug}: ${message}`); warnings++; }
  }
  console.log(`[INFO] ${tracks.length} track(s), ${errors} error(s), ${warnings} warning(s)`);
  return errors;
}
