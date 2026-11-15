// 依存なしの Front Matter 読み書き。YAML のうち、このサイトで使う範囲だけを扱う:
// 文字列 / 数値 / 真偽値 / [a, b] 形式の配列 / "- item" 形式のリスト。
import { FRONT_MATTER_ORDER } from "./constants.mjs";

export function parseFrontMatter(text) {
  text = String(text).replace(/^﻿/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { data: {}, body: text.trim() };
  const data = {};
  let listKey = null;
  for (const raw of match[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(scalar(item[1]));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value.trim() === "") {
      data[key] = "";
      listKey = key;
    } else {
      data[key] = scalar(value);
      listKey = null;
    }
  }
  return { data, body: text.slice(match[0].length).trim() };
}

function scalar(input) {
  const value = input.trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { return value.replace(/^"|"$/g, ""); }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith("[") && value.endsWith("]")) {
    try { return JSON.parse(value); } catch { /* YAML風の [a, b] */ }
    const inner = value.slice(1, -1).trim();
    return inner ? splitList(inner).map(scalar) : [];
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function splitList(inner) {
  const parts = [];
  let current = "", quote = null;
  for (const char of inner) {
    if (quote) { current += char; if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === ",") { parts.push(current); current = ""; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function stringifyFrontMatter(data, body = "") {
  const keys = [
    ...FRONT_MATTER_ORDER.filter((key) => key in data),
    ...Object.keys(data).filter((key) => !FRONT_MATTER_ORDER.includes(key))
  ];
  const lines = [];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) lines.push(`${key}: [${value.map((v) => JSON.stringify(String(v))).join(", ")}]`);
    else if (typeof value === "string") lines.push(`${key}: ${JSON.stringify(value)}`);
    else lines.push(`${key}: ${value}`);
  }
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}${body.trim() ? "\n" : ""}`;
}
