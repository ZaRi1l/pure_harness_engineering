import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverTaskSpecs } from '../scripts/catalog.mjs';

test('discovers only top-level markdown Task Specs with safe repository-relative metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-task-specs-'));
  const tasks = path.join(root, '.ai', 'tasks');
  await mkdir(path.join(tasks, 'nested'), { recursive: true });
  await writeFile(path.join(tasks, 'example.md'), '# Example plan\n\nAcceptance criteria.');
  await writeFile(path.join(tasks, 'ignored.txt'), 'not a spec');
  await writeFile(path.join(tasks, 'nested', 'hidden.md'), '# Hidden');
  const specs = discoverTaskSpecs(root);
  assert.equal(specs.length, 1);
  assert.deepEqual(Object.keys(specs[0]).sort(), ['content', 'modifiedAt', 'name', 'path', 'title']);
  assert.equal(specs[0].name, 'example');
  assert.equal(specs[0].path, '.ai/tasks/example.md');
  assert.equal(specs[0].title, 'Example plan');
  assert.match(specs[0].content, /Acceptance criteria/);
  assert.ok(Number.isFinite(Date.parse(specs[0].modifiedAt)));
});

test('returns no Task Specs when the approved directory is absent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-task-specs-empty-'));
  assert.deepEqual(discoverTaskSpecs(root), []);
});
