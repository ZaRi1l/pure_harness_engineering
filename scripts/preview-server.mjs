#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RuntimeStore, findRoot } from './runtime-state.mjs';
import { discoverCatalog, discoverTaskSpecs } from './catalog.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export async function createPreviewServer(root, host = '127.0.0.1') {
  root = path.resolve(root); const previewRoot = path.resolve(root, 'preview'), previewReal = await realpath(previewRoot), store = new RuntimeStore(root); await store.initialize();
  return http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
      const runtime = { '/runtime/snapshot': () => store.readSnapshot(), '/runtime/status': () => store.readStatus(), '/runtime/tasks': () => store.readTasks(), '/runtime/events': async () => ({ events: await store.readEvents() }), '/runtime/catalog': () => discoverCatalog(root), '/runtime/task-specs': () => ({ taskSpecs: discoverTaskSpecs(root) }) };
      if (runtime[pathname]) { response.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); response.end(JSON.stringify(await runtime[pathname]())); return; }
      const relative = ['/', '/preview', '/preview/'].includes(pathname) ? 'index.html' : pathname.replace(/^\/preview\//, '');
      const file = path.resolve(previewRoot, relative), lexical = file === previewRoot || file.startsWith(`${previewRoot}${path.sep}`);
      if (!lexical || !existsSync(file)) { response.writeHead(lexical ? 404 : 403); response.end(lexical ? 'Not found' : 'Forbidden'); return; }
      const resolved = await realpath(file), within = resolved === previewReal || resolved.startsWith(`${previewReal}${path.sep}`);
      if (!within) { response.writeHead(403); response.end('Forbidden'); return; }
      if (!(await stat(resolved)).isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); createReadStream(resolved).pipe(response);
    } catch (error) { response.writeHead(500); response.end(`Server error: ${error.message}`); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) { const host = '127.0.0.1', port = Number(process.env.PURE_HARNESS_PORT || 8765), server = await createPreviewServer(findRoot(), host); server.listen(port, host, () => console.log(`Pure Harness preview: http://${host}:${server.address().port}/`)); }
