import assert from 'node:assert/strict';
import test from 'node:test';

import { safeTask, taskRevision, validateTaskFields } from '../scripts/task-records.mjs';

test('task fields trim labels while keeping branch separate from owner', () => {
  assert.deepEqual(validateTaskFields({ title: '  Build UI  ', status: 'pending', branch: '  feature/ui  ' }),
    { title: 'Build UI', status: 'pending', branch: 'feature/ui' });
  assert.deepEqual(validateTaskFields({ title: 'Task', status: 'completed', branch: null }),
    { title: 'Task', status: 'completed', branch: null });
});

test('task fields reject missing, unknown, and client-owned properties', () => {
  for (const fields of [
    { title: 'Task', status: 'pending' },
    { title: 'Task', status: 'pending', branch: null, owner: 'agent' },
    { title: 'Task', status: 'pending', branch: null, id: 'chosen' },
    { title: 'Task', status: 'pending', branch: null, revision: 'chosen' },
    { title: 'Task', status: 'pending', branch: null, created_at: 'yesterday' },
  ]) assert.throws(() => validateTaskFields(fields), /invalid task fields/);
});

test('task fields reject invalid status and overlong or control-character labels', () => {
  const valid = { title: 'Task', status: 'pending', branch: null };
  for (const fields of [
    { ...valid, status: 'unknown' },
    { ...valid, title: 'x'.repeat(301) },
    { ...valid, branch: 'x'.repeat(121) },
    { ...valid, branch: 'feature\nname' },
    { ...valid, branch: 'feature\u007fname' },
    { ...valid, branch: '   ' },
  ]) assert.throws(() => validateTaskFields(fields), /invalid task/);
});

test('unicode_whitespace_not_a_label', () => {
  for (const label of ['\u2003', '\u200b', '\ufeff']) {
    assert.throws(() => validateTaskFields({ title: label, status: 'pending', branch: null }), /invalid task title/);
    assert.throws(() => validateTaskFields({ title: 'Task', status: 'pending', branch: label }), /invalid task branch/);
  }
});

test('meaningful interior zero-width joiner is preserved in a task title', () => {
  assert.deepEqual(validateTaskFields({ title: '  👩‍💻 Review  ', status: 'pending', branch: null }),
    { title: '👩‍💻 Review', status: 'pending', branch: null });
});

test('legacy revision is stable for canonical editable fields and timestamps', () => {
  const legacy = { id: 't1', title: 'Task', status: 'pending', owner: 'worker', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' };
  assert.equal(taskRevision(legacy), taskRevision({ ...legacy, owner: 'different' }));
  assert.notEqual(taskRevision(legacy), taskRevision({ ...legacy, title: 'Changed' }));
  assert.equal(safeTask(legacy).branch, null);
  assert.equal(safeTask(legacy).revision, taskRevision(legacy));
  assert.equal(safeTask({ ...legacy, revision: 'opaque-token' }).revision, 'opaque-token');
});
