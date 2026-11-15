// 各トラックを dt-cue の解析コアで事前解析し、content/tracks/{slug}/analysis.json に保存する。
// 音声の内容(sha1)と解析バージョンが同じなら再解析しない。
//
//   node scripts/analyze.mjs            … 未解析・変更分だけ
//   node scripts/analyze.mjs --force    … 全曲やり直し
//   node scripts/analyze.mjs {slug}...  … 指定した曲だけ
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeFile } from "./lib/analysis.mjs";
import { canDecode, findFfmpeg } from "./lib/audio.mjs";
import { ANALYSIS_FILE, ANALYZER_VERSION, AUTO_COVER_FILE } from "./lib/constants.mjs";
import { renderAutoCover } from "./lib/png.mjs";
import { loadTracks } from "./lib/tracks.mjs";
import { hashFile, loadConfig } from "./lib/util.mjs";

const force = process.argv.includes("--force");
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const tracks = (await loadTracks(await loadConfig())).filter((t) => !only.length || only.includes(t.slug));

if (!findFfmpeg()) console.warn("[WARN]  ffmpeg が見つかりません。WAV 以外は事前解析できず、ブラウザ内解析にフォールバックします。");

let analyzed = 0, skipped = 0, failed = 0;
for (const track of tracks) {
  if (track.errors.length) { console.error(`[ERROR] ${track.slug}: ${track.errors.join("; ")}`); failed++; continue; }
  if (!track.audioFile || track.status === "draft") continue;
  const audioPath = path.join(track.dir, track.audioFile);
  const coverPath = path.join(track.dir, AUTO_COVER_FILE);
  try {
    const hash = await hashFile(audioPath);
    let analysis = track.analysis;
    const fresh = analysis && analysis.v === ANALYZER_VERSION && analysis.hash === hash;
    if (!fresh || force) {
      if (!canDecode(audioPath)) { console.warn(`[WARN]  ${track.slug}: デコーダーが無いため解析を省略`); skipped++; continue; }
      const started = Date.now();
      analysis = await analyzeFile(audioPath, hash);
      await writeFile(path.join(track.dir, ANALYSIS_FILE), `${JSON.stringify(analysis)}\n`);
      analyzed++;
      const bpm = analysis.bpm === null ? `BPM不明 (${analysis.reason})` : `${analysis.bpm} BPM (${analysis.tempoCandidates[0]?.primarySupport ?? 0}/3方式)`;
      console.log(`[INFO] ${track.slug}: ${analysis.duration}s, ${bpm}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
      if (existsSync(coverPath)) await rm(coverPath); // 波形が変わったので自動カバーも作り直す
    } else skipped++;
    const hasOwnCover = track.coverFile && !track.coverAuto;
    if (hasOwnCover && existsSync(coverPath)) await rm(coverPath);
    if (!hasOwnCover && !existsSync(coverPath)) {
      await writeFile(coverPath, renderAutoCover(analysis, track.slug));
      console.log(`[INFO] ${track.slug}: ${AUTO_COVER_FILE} を生成`);
    }
  } catch (error) {
    failed++;
    console.error(`[ERROR] ${track.slug}: ${error.message}`);
  }
}
console.log(`[INFO] analyze: ${analyzed} analyzed, ${skipped} up-to-date/skipped, ${failed} failed`);
if (failed) process.exit(1);
