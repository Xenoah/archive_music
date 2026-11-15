// dist/ のローカル確認用サーバー。音声シークに必要な Range リクエストと、
// GitHub Pages と同じ「存在しないパスは 404.html」を再現する。
//   node tools/serve.mjs [--port 4173] [--base /my-repo]
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { DIST_DIR, MIME } from "../scripts/lib/constants.mjs";

const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : fallback; };
const port = Number(arg("--port", process.env.PORT || 4173));
const base = `/${String(arg("--base", process.env.PUBLIC_BASE_PATH || "")).replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const root = path.resolve(DIST_DIR);

http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }
  if (!pathname.startsWith(base)) { response.writeHead(302, { Location: base }).end(); return; }
  let file = path.join(root, pathname.slice(base.length));
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  let status = 200;
  if (!existsSync(file)) { file = path.join(root, "404.html"); status = 404; }
  if (!existsSync(file)) { response.writeHead(404).end("dist/ がありません。npm run build を先に実行してください。"); return; }
  const size = statSync(file).size;
  const headers = { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
  if (range && status === 200 && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start >= size || start > end) { response.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
    response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (request.method === "HEAD") response.end(); else createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(status, { ...headers, "Content-Length": size });
  if (request.method === "HEAD") response.end(); else createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}${base}`));
