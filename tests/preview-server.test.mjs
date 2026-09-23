import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPreviewServer } from '../scripts/preview-server.mjs';
import { RuntimeStore } from '../scripts/runtime-state.mjs';

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
  const traversal = await fetch(`http://127.0.0.1:${port}/preview/%2e%2e/secret.txt`);
  assert.match(html, /Agent Signal Network/);
  assert.match(html, /Preview Lab/);
  assert.match(html, /Agent Catalog/);
  assert.match(html, /Skill Catalog/);
  assert.match(html, /Harness Guide/);
  assert.match(html, /UI Preview Only/);
  assert.match(html, /Changes are not saved/);
  assert.match(html, /SMALL/);
  assert.match(html, /MEDIUM/);
  assert.match(html, /LARGE/);
  assert.match(html, /preview-manager/);
  assert.match(html, /task-routing/);
  assert.match(html, /Read only catalog/);
  assert.equal(status.phase, 'idle');
  assert.equal(snapshot.status.task_counts.total, snapshot.tasks.tasks.length);
  assert.ok([403, 404].includes(traversal.status));
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
