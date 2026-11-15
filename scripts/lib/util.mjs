import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { CONFIG_FILE, SLUG_RE } from "./constants.mjs";

const DEFAULT_CONFIG = {
  title: "OTODANA",
  tagline: { ja: "", en: "" },
  author: "",
  defaultLicense: "All rights reserved",
  defaultDownload: false,
  siteUrl: "",
  stream: { transcodeLossless: true, bitrate: "256k" },
  links: []
};

export async function loadConfig() {
  let user = {};
  if (existsSync(CONFIG_FILE)) user = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  const config = { ...DEFAULT_CONFIG, ...user, stream: { ...DEFAULT_CONFIG.stream, ...(user.stream || {}) } };
  if (typeof config.tagline === "string") config.tagline = { ja: config.tagline, en: config.tagline };
  return config;
}

export function slugify(name) {
  const slug = String(name)
    .normalize("NFC")
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return SLUG_RE.test(slug) ? slug : "track";
}

export function titleFromName(name) {
  return String(name).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha1");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export function hashString(text) {
  let hash = 2166136261;
  for (const char of String(text)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return hash;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(/[,、]/).map((v) => v.trim()).filter(Boolean);
  return [];
}

export function posix(file) {
  return file.replace(/\\/g, "/");
}

// 説明文用の最小 Markdown。HTML はすべてエスケープし、リンクは http(s)/mailto のみ許可する。
export function renderMarkdown(source) {
  const blocks = String(source || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const heading = /^(#{1,4})\s+(.+)$/.exec(block);
    if (heading && !block.includes("\n")) {
      const level = Math.min(4, heading[1].length + 1);
      return `<h${level}>${inline(heading[2])}</h${level}>`;
    }
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("\n");
}

function inline(text) {
  const links = [];
  const keep = (html) => `\u0000${links.push(html) - 1}\u0000`;
  let out = String(text)
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, (_, label, url) => keep(anchor(url, label)))
    .replace(/https?:\/\/[^\s<>"'）)]+/g, (url) => keep(anchor(url, url)));
  out = escapeHtml(out)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => links[Number(index)]);
}

function anchor(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function plainSummary(source, length = 160) {
  const text = String(source || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
