import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkRepository } from '../scripts/self-check.mjs';
import { rolesFor } from '../scripts/route-task.mjs';
import { discoverCatalog } from '../scripts/catalog.mjs';

test('routing keeps SMALL light and expands larger work', () => {
  assert.deepEqual(rolesFor('small'), ['worker']);
  assert.deepEqual(rolesFor('medium'), ['planner', 'worker', 'verifier', 'reviewer']);
  assert.ok(rolesFor('large').includes('supervisor'));
});

test('discovered role policies use only supported cost-aware defaults', () => {
  const catalog = discoverCatalog(path.resolve('.'));
  assert.ok(catalog.agents.length > 0);
  for (const agent of catalog.agents) {
    assert.match(agent.model, /^gpt-6-(sol|luna)$/);
    assert.ok(['low', 'medium', 'high'].includes(agent.reasoning));
    assert.notEqual(agent.model, 'gpt-6-astra');
  }
  assert.ok(catalog.agents.every(agent => agent.source.includes('model_reasoning_effort')));
  const byId = new Map(catalog.agents.map(agent => [agent.id, agent]));
  assert.deepEqual([byId.get('planner').model, byId.get('planner').reasoning], ['gpt-6-sol', 'high']);
  assert.deepEqual([byId.get('worker').model, byId.get('worker').reasoning], ['gpt-6-sol', 'medium']);
  assert.deepEqual([byId.get('verifier').model, byId.get('verifier').reasoning], ['gpt-6-luna', 'medium']);
  assert.deepEqual([byId.get('reviewer').model, byId.get('reviewer').reasoning], ['gpt-6-sol', 'high']);
});

test('generic subagent default is Luna medium while root remains inherited', async () => {
  const config = await readFile(path.resolve('.codex/config.toml'), 'utf8');
  assert.match(config, /default_subagent_model\s*=\s*"gpt-6-luna"/);
  assert.match(config, /default_subagent_reasoning_effort\s*=\s*"medium"/);
  assert.doesNotMatch(config, /(^|\n)model\s*=/);
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

test('self-check warns when Codex is not installed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pure-check-'));
  await mkdir(path.join(root, '.codex'));
  await writeFile(path.join(root, '.codex', 'config.toml'), '[features]\nhooks = true\n');
  await writeFile(path.join(root, '.codex', 'hooks.json'), '{"hooks":{}}');
  const unavailable = () => ({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) });
  const report = await checkRepository(root, { exerciseRuntime: false, exerciseHttp: false, spawnCodex: unavailable });
  assert.ok(report.warnings.some(warning => warning.includes('Codex executable unavailable')));
});

test('self-check serves both dashboard assets and renders the static network', async () => {
  const accepted = () => ({ status: 0, stdout: '{"checks":{"config.load":{"status":"ok"}}}', stderr: '' });
  const report = await checkRepository(path.resolve('.'), { spawnCodex: accepted });
  assert.equal(report.ok, true);
  assert.ok(report.checks.includes('Dashboard module is served'));
  assert.ok(report.checks.includes('Agent network renderer exists'));
  assert.ok(report.checks.includes('Agent network renderer is served'));
  assert.ok(report.checks.includes('Static agent network generation passes'));
});
