import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { main } from '../scripts/setup.mjs';

const engine = fileURLToPath(new URL('..', import.meta.url));
const exists = async file => !!(await lstat(file).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)));
async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'setup-cli-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const harnessRoot = path.join(base, 'harness');
  await mkdir(harnessRoot);
  await cp(path.join(engine, 'harness/agents'), path.join(harnessRoot, 'harness/agents'), { recursive: true });
  await cp(path.join(engine, '.agents/skills'), path.join(harnessRoot, '.agents/skills'), { recursive: true });
  await cp(path.join(engine, 'harness/compatibility.json'), path.join(harnessRoot, 'harness/compatibility.json'));
  const output = { stdout: '', stderr: '' };
  const io = { harnessRoot, stdout: { write: value => { output.stdout += value; } }, stderr: { write: value => { output.stderr += value; } } };
  return { harnessRoot, io, output };
}

test('plan-only emits one metadata JSON plan without creating management or child files', async t => {
  const f = await fixture(t);
  assert.equal(await main(['--mode', 'new', '--target', 'codex', '--plan'], f.io), 0);
  const plan = JSON.parse(f.output.stdout);
  assert.equal(plan.mode, 'new');
  assert.equal(plan.target, 'codex');
  assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness')), false);
  assert.equal(await exists(path.join(f.harnessRoot, 'project')), false);
  assert.doesNotMatch(f.output.stdout, /afterBase64|SECRET_SENTINEL/);
});

test('explicit apply consumes reviewed plan and rejects conflicting selector or tampering', async t => {
  const f = await fixture(t);
  assert.equal(await main(['--mode', 'new', '--plan'], f.io), 0);
  const plan = JSON.parse(f.output.stdout);
  const file = path.join(path.dirname(f.harnessRoot), 'reviewed.json');
  await writeFile(file, JSON.stringify(plan));
  assert.equal(await main(['--apply', file, '--mode', 'new'], f.io), 1);
  assert.equal(await exists(path.join(f.harnessRoot, 'project')), false);
  assert.equal(await main(['--apply', file], f.io), 0);
  assert.equal(JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/config.json'))).target, 'codex');
  assert.match(f.output.stdout, /npm run init/);
  assert.match(f.output.stdout, /npm run status/);
  assert.match(f.output.stdout, /npm run preview:live/);
  const altered = path.join(path.dirname(f.harnessRoot), 'altered.json');
  await writeFile(altered, JSON.stringify({ ...plan, target: 'claude' }));
  assert.equal(await main(['--apply', altered], f.io), 1);
});

test('configured target-only plan is update and invalid or legacy flags fail closed', async t => {
  const f = await fixture(t);
  await main(['--mode', 'new', '--plan'], f.io);
  const file = path.join(path.dirname(f.harnessRoot), 'reviewed.json');
  await writeFile(file, f.output.stdout);
  assert.equal(await main(['--apply', file], f.io), 0);
  f.output.stdout = '';
  assert.equal(await main(['--target', 'claude', '--plan'], f.io), 0);
  assert.equal(JSON.parse(f.output.stdout).mode, 'update');
  assert.equal(await main(['--project', 'other', '--plan'], f.io), 1);
  assert.equal(await main(['--mode', 'new', '--source', 'anything', '--plan'], f.io), 1);
});

test('interactive setup displays reviewed plan and writes only after exact hash confirmation', async t => {
  const f = await fixture(t);
  const input = new PassThrough();
  let output = '';
  const io = { harnessRoot: f.harnessRoot, stdin: input, stderr: f.io.stderr, stdout: { write(value) {
    output += value;
    if (value.includes('Project mode')) input.write('new\n');
    else if (value.includes('Target [')) input.write('\n');
    else if (value.includes('Confirmation:')) {
      const hash = /"planSha256": "([a-f0-9]{64})"/.exec(output)?.[1];
      input.write(`apply ${hash?.slice(0, 12)}\n`);
    }
  } } };
  assert.equal(await main([], io), 0);
  assert.match(output, /"bridge":/);
  assert.match(output, /Verification limit:/);
  assert.equal(JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/config.json'))).target, 'codex');
  assert.match(output, /npm run init/);
});

test('interactive existing source is prompted and unconfirmed plan remains read-only', async t => {
  const f = await fixture(t);
  const source = path.join(path.dirname(f.harnessRoot), 'source');
  await mkdir(source);
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Fixture']);
  execFileSync('git', ['-C', source, 'config', 'user.email', 'fixture@example.test']);
  await writeFile(path.join(source, 'README.md'), 'product\n');
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, 'commit', '-qm', 'fixture']);
  const input = new PassThrough();
  let output = '';
  const io = { harnessRoot: f.harnessRoot, stdin: input, stderr: f.io.stderr, stdout: { write(value) {
    output += value;
    if (value.includes('Project mode')) input.write('existing\n');
    else if (value.includes('Existing local path')) input.write(`${source}\n`);
    else if (value.includes('Target [')) input.write('claude\n');
    else if (value.includes('Confirmation:')) input.write('no\n');
  } } };
  assert.equal(await main([], io), 1);
  assert.match(output, /"mode": "existing"/);
  assert.match(output, /"target": "claude"/);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness')), false);
  assert.equal(await exists(path.join(f.harnessRoot, 'project')), false);
});
