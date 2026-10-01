#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RuntimeStore, contextFromArgs } from './runtime-state.mjs';
import { isValidatedProjectContext } from './project-context.mjs';
import { discoverCatalog, discoverTaskSpecs } from './catalog.mjs';
import { getGoalAdapter, UNSUPPORTED } from './goal-adapters.mjs';
import { safeTask, validateTaskFields } from './task-records.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const STATIC_EXTENSIONS = new Set(['.html', '.js', '.css', '.svg']);
const MODULE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const within = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
const TASK_BODY_LIMIT = 16 * 1024;
const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function taskWriteAuthorized(request, server, token) {
  const address = server.address();
  if (!address || address.address !== '127.0.0.1') return false;
  if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::ffff:127.0.0.1' && request.socket.remoteAddress !== '::1') return false;
  const expected = `127.0.0.1:${address.port}`;
  if (request.headers.host !== expected || request.headers.origin !== `http://${expected}`) return false;
  const supplied = request.headers['x-task-write-token'];
  if (typeof supplied !== 'string') return false;
  const bytes = Buffer.alloc(token.length);
  const actual = Buffer.from(supplied, 'utf8');
  actual.copy(bytes, 0, 0, token.length);
  return timingSafeEqual(bytes, token) && actual.length === token.length;
}

function readTaskBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > TASK_BODY_LIMIT) {
        request.removeAllListeners('data');
        request.resume();
        reject(Object.assign(new Error('task body too large'), { status: 413 }));
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function parsedTaskBody(source, update) {
  let value;
  try { value = JSON.parse(source); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('invalid task'), { status: 400 });
  const keys = Object.keys(value);
  if (keys.length !== (update ? 4 : 3) || !keys.every(key => ['title', 'status', 'branch', ...(update ? ['revision'] : [])].includes(key))) throw Object.assign(new Error('invalid task'), { status: 400 });
  if (update && (typeof value.revision !== 'string' || !value.revision)) throw Object.assign(new Error('invalid revision'), { status: 400 });
  let fields;
  try { fields = validateTaskFields({ title: value.title, status: value.status, branch: value.branch }); }
  catch { throw Object.assign(new Error('invalid task fields'), { status: 400 }); }
  return { fields, revision: value.revision };
}

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
  const assetRoot = options.assetRoot === undefined ? (isValidatedProjectContext(context) ? MODULE_ROOT : root) : options.assetRoot;
  if (typeof assetRoot !== 'string' || !path.isAbsolute(assetRoot)) throw new Error('assetRoot must be an absolute path');
  const previewRoot = path.resolve(assetRoot, 'preview'), previewReal = await realpath(previewRoot);
  const routes = await registeredRoutes(context, options.projectRoutes || []);
  const goalAdapter = getGoalAdapter(context, options.goalAdapters);
  const store = legacy ? RuntimeStore.legacyFixture(root, { runtimeDir: options.runtimeDir }) : new RuntimeStore(context);
  await store.initialize();
  const writeToken = randomBytes(32).toString('hex');
  const writeTokenBytes = Buffer.from(writeToken, 'utf8');
  const server = http.createServer(async (request, response) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname); }
      catch { json(response, 400, { error: 'invalid_url' }); return; }
      const taskPath = pathname === '/runtime/tasks';
      const taskItemPath = pathname.startsWith('/runtime/tasks/');
      if (taskPath || taskItemPath) {
        if (request.method === 'GET' && taskPath) {
          const document = await store.readTasks();
          json(response, 200, isValidatedProjectContext(context)
            ? { ...document, tasks: document.tasks.map(safeTask), write_token: writeToken }
            : document);
          return;
        }
        if (request.method !== (taskPath ? 'POST' : 'PUT') || !isValidatedProjectContext(context)) {
          json(response, 405, { error: 'method_not_allowed' }); return;
        }
        if (!taskWriteAuthorized(request, server, writeTokenBytes)) {
          json(response, 403, { error: 'forbidden' }); return;
        }
        if (taskItemPath && !taskIdPattern.test(pathname.slice('/runtime/tasks/'.length))) {
          json(response, 400, { error: 'invalid_task_id' }); return;
        }
        if (request.headers['content-encoding'] !== undefined || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) {
          json(response, 400, { error: 'invalid_content_type' }); return;
        }
        try {
          const { fields, revision } = parsedTaskBody(await readTaskBody(request), taskItemPath);
          if (taskPath) json(response, 201, await store.createTask(fields));
          else {
            const result = await store.updateTask(pathname.slice('/runtime/tasks/'.length), revision, fields);
            if (result.kind === 'missing') json(response, 404, { error: 'task_not_found' });
            else if (result.kind === 'conflict') json(response, 409, { error: 'stale_revision', current: result.task });
            else json(response, 200, result.task);
          }
        } catch (error) {
          if (error.status === 400 || error.status === 413) json(response, error.status, { error: error.status === 413 ? 'body_too_large' : 'invalid_task' });
          else throw error;
        }
        return;
      }
      if (goalAdapter !== UNSUPPORTED && await goalAdapter.handleHttp(request, response, { pathname, host })) return;
      if (request.method !== 'GET') { response.writeHead(405, { 'Cache-Control': 'no-store' }); response.end('Method not allowed'); return; }
      const runtime = { '/runtime/snapshot': () => store.readSnapshot(), '/runtime/status': () => store.readStatus(), '/runtime/events': async () => ({ events: await store.readEvents() }), '/runtime/catalog': () => discoverCatalog(context), '/runtime/task-specs': () => ({ taskSpecs: discoverTaskSpecs(context) }) };
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
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) { const host = '127.0.0.1', port = Number(process.env.PURE_HARNESS_PORT || 8765), { context } = await contextFromArgs(process.argv.slice(2)); const server = await createPreviewServer(context, host); server.listen(port, host, () => console.log(`Pure Harness preview: http://${host}:${server.address().port}/`)); }
