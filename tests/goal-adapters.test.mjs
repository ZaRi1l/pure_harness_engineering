import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getGoalAdapter, UNSUPPORTED } from '../scripts/goal-adapters.mjs';
import { createPreviewServer } from '../scripts/preview-server.mjs';

test('undeclared GOAL adapter is unsupported', () => {
  const context = { projectId: 'alpha', adapters: {} };
  assert.equal(getGoalAdapter(context, { example: () => { throw new Error('must not run'); } }), UNSUPPORTED);
});

test('declared adapter receives selected context', () => {
  const context = { projectId: 'beta', adapters: { goal: { type: 'example' } } };
  const adapter = { readGoals: async () => ({ items: [] }) };
  assert.equal(getGoalAdapter(context, { example: selected => {
    assert.equal(selected, context);
    return adapter;
  } }), adapter);
});

test('unknown declared adapter remains unsupported', () => {
  assert.equal(getGoalAdapter({ projectId: 'alpha', adapters: { goal: { type: 'unknown' } } }, {}), UNSUPPORTED);
});

test('preview invokes only explicitly registered GOAL handler', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'goal-dispatch-'));
  await mkdir(path.join(root, 'preview'));
  await writeFile(path.join(root, 'preview', 'index.html'), 'dashboard');
  const context = { kind: 'legacy-fixture', root, projectId: 'alpha', adapters: { goal: { type: 'example' } } };
  const server = await createPreviewServer(context, '127.0.0.1', { goalAdapters: { example: selected => {
    assert.equal(selected, context);
    return { handleHttp: async (request, response, { pathname }) => {
      if (pathname !== '/runtime/goals') return false;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ projectId: selected.projectId }));
      return true;
    } };
  } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/runtime/goals`);
  assert.deepEqual(await response.json(), { projectId: 'alpha' });
});
