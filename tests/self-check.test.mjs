import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkRepository } from '../scripts/self-check.mjs';
import { rolesFor } from '../scripts/route-task.mjs';

test('routing keeps SMALL light and expands larger work', () => {
  assert.deepEqual(rolesFor('small'), ['worker']);
  assert.deepEqual(rolesFor('medium'), ['planner', 'worker', 'verifier', 'reviewer']);
  assert.ok(rolesFor('large').includes('supervisor'));
});

test('self-check rejects invalid config and empty hooks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-check-'));
  await mkdir(path.join(root, '.codex'));
  await writeFile(path.join(root, '.codex', 'config.toml'), '[agents\ninvalid');
  await writeFile(path.join(root, '.codex', 'hooks.json'), '{"hooks":{}}');
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some(failure => failure.includes('Codex config')));
  assert.ok(report.failures.some(failure => failure.includes('required hook event')));
});

test('self-check fails when Codex is not installed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-check-'));
  await mkdir(path.join(root, '.codex'));
  await writeFile(path.join(root, '.codex', 'config.toml'), '[features]\nhooks = true\n');
  await writeFile(path.join(root, '.codex', 'hooks.json'), '{"hooks":{}}');
  const unavailable = () => ({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) });
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false, spawnCodex: unavailable });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some(failure => failure.includes('Codex executable unavailable')));
});
