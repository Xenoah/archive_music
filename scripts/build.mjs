// content/tracks/ と site/ から、公開する最終フォルダ dist/ を組み立てる。
//
//   dist/index.html, 404.html, about/        … アプリ本体（どのURLでも同じシェル）
//   dist/t/{slug}/index.html                 … 曲ごとのページ（OGP・JSON-LD 入り）
//   dist/media/{slug}/                       … 音声・カバー・analysis.json
//   dist/data/tracks.json                    … 一覧データ
//   dist/catalog.json, llms.txt              … AIエージェント向けカタログと案内
//   dist/rss.xml, sitemap.xml, robots.txt
//
// 環境変数: PUBLIC_BASE_PATH (例 /my-repo)、PUBLIC_SITE (例 https://user.github.io)
import { generateDemo } from "./generate-demo.mjs";
import { writeStudio } from "./lib/studio.mjs";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeFile } from "./lib/analysis.mjs";
import { canDecode, findFfmpeg, transcodeToMp3 } from "./lib/audio.mjs";
import { ANALYZER_VERSION, CACHE_DIR, DIST_DIR, LOSSLESS_EXTENSIONS, MIME, SITE_DIR } from "./lib/constants.mjs";
import { renderAutoCover } from "./lib/png.mjs";
import { loadTracks, reportTracks } from "./lib/tracks.mjs";
import { escapeHtml, hashFile, loadConfig, plainSummary, renderMarkdown } from "./lib/util.mjs";

if (process.argv[2]) process.chdir(path.resolve(process.argv[2]));
const config = await loadConfig();
if (config.demos && process.env.INCLUDE_DEMOS !== "false") await generateDemo(process.cwd());
const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");
const isActions = process.env.GITHUB_ACTIONS === "true";
const autoBase = isActions && repo && repo.toLowerCase() !== `${owner}.github.io`.toLowerCase() ? repo : "";
const base = `/${(process.env.PUBLIC_BASE_PATH ?? autoBase).replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const origin = (process.env.PUBLIC_SITE ?? (config.siteUrl || (isActions && owner ? `https://${owner}.github.io` : ""))).replace(/\/+$/, "");
const buildId = Date.now().toString(36);
const absolute = (rel = "") => (origin ? `${origin}${base}${rel}` : `${base}${rel}`);
const enc = encodeURIComponent;

const tracks = await loadTracks(config);
if (reportTracks(tracks) > 0) {
  console.error("[ERROR] エラーのあるトラックがあるためビルドを中止しました。");
  process.exit(1);
}

await rm(DIST_DIR, { recursive: true, force: true });
await mkdir(path.join(DIST_DIR, "data"), { recursive: true });
await cp(SITE_DIR, DIST_DIR, { recursive: true, filter: (source) => !source.endsWith("template.html") });

const ffmpeg = findFfmpeg();
const published = [];
const studioAnalyses = new Map();
for (const track of tracks) {
  if (track.status === "draft" || (track.demo && (!config.demos || process.env.INCLUDE_DEMOS === "false"))) continue;
  const mediaDir = path.join(DIST_DIR, "media", track.slug);
  await mkdir(mediaDir, { recursive: true });
  const mediaUrl = `media/${enc(track.slug)}/`;
  const audioPath = path.join(track.dir, track.audioFile);
  const ext = path.extname(track.audioFile).toLowerCase();
  const hash = await hashFile(audioPath);

  // --- 解析: コミット済みの analysis.json が最新ならそれを使い、無ければここで解析する
  const cacheFile = path.join(CACHE_DIR, "analysis", `${hash}-v${ANALYZER_VERSION}.json`);
  let analysis = track.analysis;
  if (!analysis && existsSync(cacheFile)) { try { analysis = JSON.parse(await readFile(cacheFile, "utf8")); } catch {} }
  if (!analysis || analysis.v !== ANALYZER_VERSION || analysis.hash !== hash) {
    analysis = null;
    if (canDecode(audioPath)) {
      try { analysis = await analyzeFile(audioPath, hash); console.log(`[INFO] ${track.slug}: ビルド時に解析 (${analysis.bpm ?? "?"} BPM)`); }
      catch (error) { console.warn(`[WARN]  ${track.slug}: 解析に失敗 (${error.message})。ブラウザ内解析にフォールバックします`); }
    } else console.warn(`[WARN]  ${track.slug}: 事前解析なし。ブラウザ内解析にフォールバックします`);
  }
  if (analysis) {
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(analysis));
    studioAnalyses.set(track.slug, analysis);
    const { mini, hash: _hash, ...publicAnalysis } = analysis;
    await writeFile(path.join(mediaDir, "analysis.json"), JSON.stringify(publicAnalysis));
  }

  // --- 音声: ロスレスは配信用 mp3 を作る（キャッシュあり）。原本は download: true のときだけ公開
  let streamFile = track.audioFile, streamExt = ext, originalPublished = false;
  if (config.stream.transcodeLossless && LOSSLESS_EXTENSIONS.has(ext) && ffmpeg) {
    const cached = path.join(CACHE_DIR, "stream", `${hash}-${config.stream.bitrate}.mp3`);
    if (!existsSync(cached)) {
      await mkdir(path.dirname(cached), { recursive: true });
      transcodeToMp3(audioPath, cached, config.stream.bitrate);
      console.log(`[INFO] ${track.slug}: 配信用 mp3 を生成 (${config.stream.bitrate})`);
    }
    streamFile = "stream.mp3";
    streamExt = ".mp3";
    await copyFile(cached, path.join(mediaDir, streamFile));
  } else {
    await copyFile(audioPath, path.join(mediaDir, track.audioFile));
    originalPublished = true;
  }
  if (track.download && !originalPublished) await copyFile(audioPath, path.join(mediaDir, track.audioFile));

  // --- カバー
  let cover = null;
  if (track.coverFile && !track.coverAuto) {
    await copyFile(path.join(track.dir, track.coverFile), path.join(mediaDir, track.coverFile));
    cover = `${mediaUrl}${enc(track.coverFile)}`;
  } else if (analysis) {
    await writeFile(path.join(mediaDir, "auto-cover.png"), renderAutoCover(analysis, track.slug));
    cover = `${mediaUrl}auto-cover.png`;
  }
  
  // --- MIDI（あればダウンロード用に公開する）
  
  
  let midi = null;
  if (track.midiFile) {
    await copyFile(path.join(track.dir, track.midiFile), path.join(mediaDir, track.midiFile));
    midi = `${mediaUrl}${enc(track.midiFile)}`;
  }

  const bpm = track.bpmManual ?? analysis?.bpm ?? null;
  published.push({
    slug: track.slug,
    demo: track.demo,
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    tags: track.tags,
    generationTools: track.generationTools,
  
    key: track.key,
    license: track.license,
    status: track.status,
    date: track.createdAt || track.uploadedAt || "",
    uploadedAt: track.uploadedAt,
    updatedAt: track.updatedAt,
    duration: analysis?.duration ?? null,
    bpm,
    bpmSource: track.bpmManual !== null ? "manual" : analysis?.bpm != null ? "auto" : null,
    audio: `${mediaUrl}${enc(streamFile)}`,
    audioType: MIME[streamExt] || "audio/mpeg",
    audioBytes: (await stat(path.join(mediaDir, streamFile))).size,
    format: ext.slice(1).toUpperCase(),
    download: track.download ? `${mediaUrl}${enc(track.audioFile)}` : null,
    downloadName: track.download ? `${track.slug}${ext}` : null,
    midi,
    midiName: midi ? `${track.slug}${path.extname(track.midiFile).toLowerCase()}` : null,
    cover,
    analysis: analysis ? `${mediaUrl}analysis.json` : null,
    mini: analysis?.mini ?? null,
    summary: plainSummary(track.body),
    descriptionHtml: renderMarkdown(track.body)
  });
}

published.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title));
const listed = published.filter((t) => t.status !== "hidden");
const indexable = published.filter((t) => t.status === "public");
await writeFile(path.join(DIST_DIR, "data", "tracks.json"), JSON.stringify({ build: buildId, tracks: listed }));
await writeStudio(listed, studioAnalyses, config);
await copyFile(path.join(SITE_DIR, "src", "LICENSE.dt-cue.txt"), path.join(DIST_DIR, "DTCUE-LICENSE.txt"));

// --- HTML
const template = await readFile(path.join(SITE_DIR, "template.html"), "utf8");
const aboutPath = path.join("content", "about.md");
const aboutHtml = existsSync(aboutPath) ? renderMarkdown(await readFile(aboutPath, "utf8")) : "";
const site = { title: config.title, tagline: config.tagline, author: config.author, links: config.links, about: aboutHtml, hasOrigin: Boolean(origin) };
const tagline = config.tagline.ja || config.tagline.en || "";

function page({ title, description, rel, robots = "index, follow", image, type = "website", jsonLd, boot = {}, staticHtml = "" }) {
  const head = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${robots}">`,
    origin ? `<link rel="canonical" href="${escapeHtml(absolute(rel))}">` : "",
    `<meta property="og:site_name" content="${escapeHtml(config.title)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    origin ? `<meta property="og:url" content="${escapeHtml(absolute(rel))}">` : "",
    image && origin ? `<meta property="og:image" content="${escapeHtml(absolute(image))}">` : "",
    `<meta name="twitter:card" content="summary">`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(config.title)} RSS" href="${escapeHtml(absolute("rss.xml"))}">`,
    `<link rel="alternate" type="application/json" title="${escapeHtml(config.title)} track catalog (JSON)" href="${escapeHtml(absolute("data/tracks.json"))}">`,
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""
  ].filter(Boolean).join("\n");
  const values = {
    title: escapeHtml(title), head, base, build: buildId, siteTitle: escapeHtml(config.title), static: staticHtml,
    boot: JSON.stringify({ site, build: buildId, ...boot }).replace(/</g, "\\u003c")
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

const listHtml = `<h1>${escapeHtml(config.title)}</h1><p>${escapeHtml(tagline)}</p><ul>${indexable.map((t) => `<li><a href="${base}t/${enc(t.slug)}/">${escapeHtml(t.title)}</a>${t.artist ? ` — ${escapeHtml(t.artist)}` : ""}</li>`).join("")}</ul>`;
const home = page({
  title: tagline ? `${config.title} — ${tagline}` : config.title,
  description: tagline || `${config.title} の楽曲一覧`, rel: "", staticHtml: listHtml,
  jsonLd: {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: config.title, ...(origin ? { url: absolute("") } : {}) },
      ...(indexable.length ? [{
        "@type": "ItemList", name: `${config.title} — tracks`, numberOfItems: indexable.length,
        itemListElement: indexable.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.title, ...(origin ? { url: absolute(`t/${enc(t.slug)}/`) } : {}) }))
      }] : [])
    ]
  }
});
await writeFile(path.join(DIST_DIR, "index.html"), home);
await writeFile(path.join(DIST_DIR, "404.html"), page({ title: config.title, description: tagline, rel: "", robots: "noindex, follow" }));
await mkdir(path.join(DIST_DIR, "about"), { recursive: true });
await writeFile(path.join(DIST_DIR, "about", "index.html"), page({ title: `About — ${config.title}`, description: tagline, rel: "about/", staticHtml: `<h1>About</h1>${aboutHtml}` }));

const isoDuration = (seconds) => `PT${Math.floor(seconds / 60)}M${Math.round(seconds % 60)}S`;
for (const track of published) {
  const dir = path.join(DIST_DIR, "t", track.slug);
  await mkdir(dir, { recursive: true });
  const facts = [track.artist, track.genre, track.bpm ? `${track.bpm} BPM` : "", track.generationTools.length ? `生成ツール: ${track.generationTools.join(" / ")}` : ""].filter(Boolean).join(" · ");
  const description = track.summary || facts || track.title;
  await writeFile(path.join(dir, "index.html"), page({
    title: `${track.title}${track.artist ? ` — ${track.artist}` : ""} | ${config.title}`,
    description, rel: `t/${enc(track.slug)}/`, image: track.cover, type: "music.song",
    robots: track.status === "public" ? "index, follow" : "noindex, follow",
    boot: { track },
    staticHtml: `<h1>${escapeHtml(track.title)}</h1><p>${escapeHtml(facts)}</p>${track.descriptionHtml}<p><a href="${base}">${escapeHtml(config.title)}</a></p>`,
    jsonLd: {
      "@context": "https://schema.org", "@type": "MusicRecording", name: track.title,
      ...(track.artist ? { byArtist: { "@type": "MusicGroup", name: track.artist } } : {}),
      ...(track.duration ? { duration: isoDuration(track.duration) } : {}),
      ...(track.genre ? { genre: track.genre } : {}),
      ...(track.tags.length ? { keywords: track.tags.join(", ") } : {}),
      ...(track.license ? { license: track.license } : {}),
      ...(track.date ? { datePublished: track.date } : {}),
      ...(origin ? { url: absolute(`t/${enc(track.slug)}/`) } : {}),
      ...(origin && track.cover ? { image: absolute(track.cover) } : {}),
      ...(origin ? { audio: { "@type": "AudioObject", contentUrl: absolute(track.audio), encodingFormat: track.audioType, ...(track.duration ? { duration: isoDuration(track.duration) } : {}) } } : {}),
      identifier: track.slug
    }
  }));
}

// --- RSS（enclosure 付きなのでポッドキャストアプリでも購読できる）/ sitemap / robots
const xml = (value) => escapeHtml(value);
const rssItems = indexable.slice(0, 100).map((t) => `<item>
<title>${xml(t.title)}</title>
<link>${xml(absolute(`t/${enc(t.slug)}/`))}</link>
<guid isPermaLink="false">${xml(t.slug)}</guid>
${t.date ? `<pubDate>${new Date(`${t.date}T00:00:00Z`).toUTCString()}</pubDate>` : ""}
<description>${xml(t.summary || t.title)}</description>
<enclosure url="${xml(absolute(t.audio))}" length="${t.audioBytes}" type="${t.audioType}"/>
</item>`).join("\n");
await writeFile(path.join(DIST_DIR, "rss.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${xml(config.title)}</title>
<link>${xml(absolute(""))}</link>
<description>${xml(tagline || config.title)}</description>
${rssItems}
</channel></rss>
`);
if (origin) {
  const urls = ["", "about/", ...indexable.map((t) => `t/${enc(t.slug)}/`)];
  await writeFile(path.join(DIST_DIR, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((rel) => `<url><loc>${xml(absolute(rel))}</loc></url>`).join("\n")}
</urlset>
`);
}
const aiCrawlers = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai", "Google-Extended", "PerplexityBot", "Perplexity-User", "Applebot-Extended", "CCBot", "Meta-ExternalAgent", "cohere-ai", "DuckAssistBot", "MistralAI-User", "YouBot"];
await writeFile(path.join(DIST_DIR, "robots.txt"), [
  `# ${config.title} — for AI agents: ${absolute("llms.txt")} (site guide and full track list), JSON catalog: ${absolute("catalog.json")}`,
  ...aiCrawlers.map((ua) => `User-agent: ${ua}\nAllow: /\n`),
  "User-agent: *",
  "Allow: /",
  ...(origin ? [`Sitemap: ${absolute("sitemap.xml")}`] : []),
  ""
].join("\n"));

// --- AIエージェント向け: catalog.json（絶対URLで引ける全曲カタログ）と llms.txt（案内＋全曲リスト）
const catalogTracks = indexable.map((t) => ({
  title: t.title,
  artist: t.artist,
  genre: t.genre,
  tags: t.tags,
  bpm: t.bpm,
  key: t.key,
  durationSeconds: t.duration,
  license: t.license,
  generationTools: t.generationTools,
  published: t.date || null,
  page: absolute(`t/${enc(t.slug)}/`),
  audio: absolute(t.audio),
  ...(t.midi ? { midi: absolute(t.midi) } : {}),
  ...(t.cover ? { cover: absolute(t.cover) } : {}),
  ...(t.download ? { download: absolute(t.download) } : {})
}));
await writeFile(path.join(DIST_DIR, "catalog.json"), JSON.stringify({
  name: config.title,
  description: tagline || `${config.title} の楽曲カタログ`,
  ...(origin ? { url: absolute("") } : {}),
  author: config.author,
  defaultLicense: config.defaultLicense,
  build: buildId,
  trackCount: catalogTracks.length,
  tracks: catalogTracks
}, null, 2));
const mmss = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
await writeFile(path.join(DIST_DIR, "llms.txt"), [
  `# ${config.title}`,
  "",
  `> ${tagline || `${config.title} の楽曲アーカイブ`}。${config.author} がAI作曲ツールで制作したBGM ${indexable.length}曲を公開するアーカイブです。各曲のページで試聴できます。MIDIファイルを用意した曲は、カタログと下記リストにMIDIのURLを併記しています。`,
  "",
  "## Machine-readable resources",
  "",
  `- Full track catalog (JSON, absolute URLs): ${absolute("catalog.json")}`,
  `- Track data used by the site player (JSON): ${absolute("data/tracks.json")}`,
  `- RSS feed (with audio enclosures): ${absolute("rss.xml")}`,
  `- Sitemap: ${absolute("sitemap.xml")}`,
  `- About: ${absolute("about/")}`,
  "",
  "## Usage and license",
  "",
  `- Default license: ${config.defaultLicense}. Individual tracks may state a different license in the catalog's license field.`,
  "- When recommending or citing a track, link to its track page URL.",
  "- Audio files are for listening via this site. Do not redistribute audio files. A separate download URL is provided in the catalog only for tracks whose download field is set.",
  "- Each track lists its generationTools (the AI tools used to create it).",
  "",
  "## Tracks",
  "",
  ...indexable.map((t) => {
    const facts = [t.genre, t.bpm ? `${t.bpm} BPM` : "", t.key || "", t.duration != null ? mmss(t.duration) : "", t.generationTools.length ? `tools: ${t.generationTools.join(", ")}` : ""].filter(Boolean).join(" · ");
    return `- [${t.title}](${absolute(`t/${enc(t.slug)}/`)}): ${facts} — audio: ${absolute(t.audio)}${t.midi ? ` — MIDI: ${absolute(t.midi)}` : ""}`;
  }),
  ""
].join("\n"));
await writeFile(path.join(DIST_DIR, ".nojekyll"), "");

console.log(`[INFO] build: ${published.length} track(s) -> ${DIST_DIR}/  (base: ${base}${origin ? `, site: ${origin}` : ""})`);
