// 本地静态服务器：模拟 GitHub Pages 项目站点路径结构。
// /Agent2026N1W/* -> dist/client/*
// / -> dist/client/index.html（便于直接打开根路径调试）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? 'dist/client';
const PORT = Number(process.argv[3] ?? 8787);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.rsc': 'text/x-component',
};

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/Agent2026N1W')) {
      pathname = pathname.slice('/Agent2026N1W'.length) || '/';
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const safe = normalize(pathname).replace(/^([./]+)/, '');
    const filePath = join(ROOT, safe);
    let data = await readFile(filePath);
    if (pathname.endsWith('.html')) {
      data = Buffer.concat([
        data,
        Buffer.from(
          `<script>
            (function () {
              var show = function (label, detail) {
                var box = document.createElement('pre');
                box.style.cssText =
                  'position:fixed;left:0;right:0;bottom:0;z-index:999999;margin:0;padding:8px;' +
                  'background:rgba(17,17,17,0.94);color:#ff6b6b;font:11px/1.4 monospace;' +
                  'white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto;border-top:2px solid #ff6b6b;';
                box.textContent = label + '\\n' + detail;
                document.body.appendChild(box);
              };
              window.addEventListener('error', function (e) {
                show('[window.onerror]', (e.error && (e.error.stack || e.error.message)) || e.message);
              });
              window.addEventListener('unhandledrejection', function (e) {
                var r = e.reason;
                show('[unhandledrejection]', (r && (r.stack || r.message)) || String(r));
              });
            })();
          </script>`,
        ),
      ]);
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
    console.log(`${new Date().toISOString()} 200 ${req.url} (${Date.now() - startedAt}ms)`);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    console.log(`${new Date().toISOString()} 404 ${req.url}`);
  }
});

server.listen(PORT, () => {
  console.log(`模拟站点已启动: http://127.0.0.1:${PORT}/Agent2026N1W/`);
});
