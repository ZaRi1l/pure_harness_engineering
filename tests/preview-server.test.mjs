import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPreviewServer } from '../scripts/preview-server.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';
import { discoverCatalog } from '../scripts/catalog.mjs';

test('serves dashboard and runtime JSON while rejecting traversal', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-preview-'));
  await mkdir(path.join(root, 'preview'));
  await copyFile(path.resolve('preview/index.html'), path.join(root, 'preview/index.html'));
  await new RuntimeStore(root).initialize();
  const server = await createPreviewServer(root, '127.0.0.1', 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const status = await (await fetch(`http://127.0.0.1:${port}/runtime/status`)).json();
  const snapshot = await (await fetch(`http://127.0.0.1:${port}/runtime/snapshot`)).json();
  const catalogResponse = await fetch(`http://127.0.0.1:${port}/runtime/catalog`), catalog = await catalogResponse.json();
  const traversal = await fetch(`http://127.0.0.1:${port}/preview/%2e%2e/secret.txt`);
  assert.match(html, /Signal Timeline/);
  assert.match(html, /Preview Lab/);
  assert.match(html, /Agent Catalog/);
  assert.match(html, /Skill Catalog/);
  assert.match(html, /Harness Guide/);
  assert.match(html, /Non-mutating UI proposals/);
  assert.match(html, /Watchdog Warnings/);
  assert.match(html, /npm run preview:live/);
  assert.match(html, /host\.replaceChildren\(\)/);
  assert.equal(catalogResponse.status, 200);
  assert.ok(Array.isArray(catalog.agents));
  assert.ok(Array.isArray(catalog.skills));
  assert.equal(status.phase, 'idle');
  assert.equal(snapshot.status.task_counts.total, snapshot.tasks.tasks.length);
  assert.ok([403, 404].includes(traversal.status));
});

test('catalog exposes read-only source and role policy metadata', () => {
  const catalog = discoverCatalog(path.resolve('.'));
  const planner = catalog.agents.find(agent => agent.id === 'planner');
  const testing = catalog.skills.find(skill => skill.id === 'testing');
  assert.equal(planner.model, 'gpt-6-sol');
  assert.equal(planner.reasoning, 'high');
  assert.match(planner.source, /developer_instructions/);
  assert.match(testing.source, /name: testing/);
});

test('guide commands remain backed by package scripts', async () => {
  const scripts = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).scripts;
  const html = await readFile(path.resolve('preview/index.html'), 'utf8');
  for (const command of ['init', 'status', 'watchdog', 'preview', 'preview:live', 'test', 'self-check']) {
    assert.ok(scripts[command]);
    assert.match(html, new RegExp(command === 'test' ? 'npm test' : 'npm run ' + command));
  }
});

test('rejects preview links that resolve outside preview root', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-preview-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'pure-preview-outside-'));
  await mkdir(path.join(root, 'preview'));
  await copyFile(path.resolve('preview/index.html'), path.join(root, 'preview/index.html'));
  await writeFile(path.join(outside, 'secret.txt'), 'outside');
  try {
    await symlink(outside, path.join(root, 'preview', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('Creating a test link requires unavailable Windows privileges');
      return;
    }
    throw error;
  }
  await new RuntimeStore(root).initialize();
  const server = await createPreviewServer(root, '127.0.0.1', 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/preview/linked/secret.txt`);
  assert.equal(response.status, 403);
});
