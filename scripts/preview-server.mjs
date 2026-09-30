#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RuntimeStore, contextFromArgs } from './runtime-state.mjs';
import { isValidatedProjectContext } from './project-context.mjs';
import { discoverCatalog, discoverTaskSpecs } from './catalog.mjs';
import { getGoalAdapter, UNSUPPORTED } from './goal-adapters.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const STATIC_EXTENSIONS = new Set(['.html', '.js', '.css', '.svg']);
const within = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);

async function registeredRoutes(context, routes) {
  if (!Array.isArray(routes)) throw new Error('projectRoutes must be an array');
  if (routes.length && !isValidatedProjectContext(context)) throw new Error('project routes require validated context');
  const result = [];
  for (const route of routes) {
    if (!/^\/[a-z][a-z0-9-]*\/$/.test(route?.prefix) || ['/preview/', '/runtime/'].includes(route.prefix) || typeof route.root !== 'string' || !path.isAbsolute(route.root) || typeof route.allow !== 'function') throw new Error('invalid project route');
    if (result.some(item => item.prefix === route.prefix)) throw new Error('duplicate project route');
    const root = await realpath(route.root);
    if (!within(context.projectRoot, root) || root === context.projectRoot || !(await stat(root)).isDirectory()) throw new Error('project route outside selected project');
    result.push({ prefix: route.prefix, root, allow: route.allow });
  }
  return result;
}

async function serveAsset(response, root, relative, allow) {
  if (relative.includes('\\') || relative.split('/').some(segment => segment === '.' || segment === '..') || !allow(relative)) { response.writeHead(403); response.end('Forbidden'); return; }
  const file = path.resolve(root, relative);
  if (!within(root, file)) { response.writeHead(403); response.end('Forbidden'); return; }
  if (!existsSync(file)) { response.writeHead(404); response.end('Not found'); return; }
  const resolved = await realpath(file);
  if (!within(root, resolved)) { response.writeHead(403); response.end('Forbidden'); return; }
  const canonicalRelative = path.relative(root, resolved).split(path.sep).join('/');
  if (!allow(canonicalRelative)) { response.writeHead(403); response.end('Forbidden'); return; }
  if (!(await stat(resolved)).isFile()) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(resolved).pipe(response);
}
export async function createPreviewServer(context, host = '127.0.0.1', options = {}) {
  const legacy = context?.kind === 'legacy-fixture';
  const root = legacy ? context.root : context?.harnessRoot;
  if (!root) throw new Error('validated project context required');
  if (host !== '127.0.0.1') throw new Error('preview must bind to localhost');
  const previewRoot = path.resolve(root, 'preview'), previewReal = await realpath(previewRoot);
  const routes = await registeredRoutes(context, options.projectRoutes || []);
  const goalAdapter = getGoalAdapter(context, options.goalAdapters);
  const store = legacy ? RuntimeStore.legacyFixture(root, { runtimeDir: options.runtimeDir }) : new RuntimeStore(context);
  await store.initialize();
  return http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
      if (goalAdapter !== UNSUPPORTED && await goalAdapter.handleHttp(request, response, { pathname, host })) return;
      if (request.method !== 'GET') { response.writeHead(405, { 'Cache-Control': 'no-store' }); response.end('Method not allowed'); return; }
      const runtime = { '/runtime/snapshot': () => store.readSnapshot(), '/runtime/status': () => store.readStatus(), '/runtime/tasks': () => store.readTasks(), '/runtime/events': async () => ({ events: await store.readEvents() }), '/runtime/catalog': () => discoverCatalog(context), '/runtime/task-specs': () => ({ taskSpecs: discoverTaskSpecs(context) }) };
      if (runtime[pathname]) { response.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); response.end(JSON.stringify(await runtime[pathname]())); return; }
      if (pathname.startsWith('/runtime/')) { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end('Not found'); return; }
      for (const route of routes) {
        if (pathname === route.prefix.slice(0, -1)) { response.writeHead(308, { Location: route.prefix, 'Cache-Control': 'no-store' }); response.end(); return; }
        if (pathname.startsWith(route.prefix)) {
          await serveAsset(response, route.root, pathname.slice(route.prefix.length) || 'index.html', route.allow);
          return;
        }
      }
      const relative = ['/', '/preview', '/preview/'].includes(pathname) ? 'index.html' : pathname.replace(/^\/preview\//, '');
      await serveAsset(response, previewReal, relative, file => STATIC_EXTENSIONS.has(path.extname(file)));
    } catch { response.writeHead(500); response.end('Server error'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) { const host = '127.0.0.1', port = Number(process.env.PURE_HARNESS_PORT || 8765), { context } = await contextFromArgs(process.argv.slice(2)); const server = await createPreviewServer(context, host); server.listen(port, host, () => console.log(`Pure Harness preview: http://${host}:${server.address().port}/`)); }
