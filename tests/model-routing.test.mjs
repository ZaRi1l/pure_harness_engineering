import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('model routing policy limits GPT-5.6 retry to explicit model availability failures', async () => {
  const source = await readFile(path.resolve('.agents/skills/model-routing/SKILL.md'), 'utf8');
  assert.match(source, /^name: model-routing$/m);
  assert.match(source, /Retry exactly once with the corresponding GPT-5\.6 model/);
  assert.match(source, /Do not retry for tool, test, implementation, permission, timeout, or task failures/);
  assert.match(source, /Do not include Astra/);
});
