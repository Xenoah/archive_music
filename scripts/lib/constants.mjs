import path from "node:path";

export const INBOX_DIR = "_inbox";
export const UPLOADED_DIR = "_uploaded";
export const TRACKS_DIR = path.join("content", "tracks");
export const SITE_DIR = "site";
export const DIST_DIR = "dist";
export const CACHE_DIR = ".cache";
export const CONFIG_FILE = "site.config.json";

// 解析結果の形式やアルゴリズムを変えたら上げる。古い analysis.json は作り直される。
export const ANALYZER_VERSION = 2; // Integrated 24 kHz bounded decoding and packed-wave output.
export const ANALYSIS_FILE = "analysis.json";
export const AUTO_COVER_FILE = "auto-cover.png";

export const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".wav", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".aif", ".aiff", ".webm"
]);
export const LOSSLESS_EXTENSIONS = new Set([".wav", ".flac", ".aif", ".aiff"]);
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
export const INFO_EXTENSIONS = new Set([".md", ".json", ".txt"]);

export const MIME = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg",
  ".oga": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".aif": "audio/aiff", ".aiff": "audio/aiff", ".webm": "audio/webm",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".avif": "image/avif", ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

// URL・フォルダ名・Markdown名になる。文字/数字で始まり、文字・数字・-・_ のみ。
export const SLUG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
export const STATUSES = new Set(["public", "draft", "hidden"]);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const FRONT_MATTER_ORDER = [
  "title", "artist", "album", "genre", "tags", "generationTools", "bpm", "key", "license", "status",
  "download", "createdAt", "uploadedAt", "updatedAt", "audio", "cover"
];
