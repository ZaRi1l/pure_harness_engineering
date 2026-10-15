import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { main } from '../scripts/setup.mjs';
import { planProjectSetup } from '../harness/project-setup.mjs';

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
  await mkdir(path.join(harnessRoot, 'scripts'));
  await cp(path.join(engine, 'scripts/hook-runtime.mjs'), path.join(harnessRoot, 'scripts/hook-runtime.mjs'));
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
  assert.equal(plan.profile, 'all');
  assert.equal(Object.keys(plan.bridge.sourceHashes.roles).length, 15);
  assert.equal(Object.keys(plan.bridge.sourceHashes.skills).filter(key => key.endsWith('/SKILL.md')).length, 8);
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
  const update = JSON.parse(f.output.stdout);
  assert.equal(update.mode, 'update');
  assert.equal(update.profile, 'all');
  assert.equal(update.bridge.sourceHashes.hookRuntime, createHash('sha256')
    .update(await readFile(path.join(f.harnessRoot, 'scripts/hook-runtime.mjs'))).digest('hex'));
  assert.equal(await main(['--profile', 'invalid', '--plan'], f.io), 1);
  assert.equal(await main(['--profile', 'core', '--profile', 'all', '--plan'], f.io), 1);
  assert.equal(await main(['--project', 'other', '--plan'], f.io), 1);
  assert.equal(await main(['--mode', 'new', '--source', 'anything', '--plan'], f.io), 1);
});

test('explicit core profile persists and update keeps it unless overridden', async t => {
  const f = await fixture(t);
  assert.equal(await main(['--mode', 'new', '--profile', 'core', '--plan'], f.io), 0);
  const first = JSON.parse(f.output.stdout);
  assert.equal(first.profile, 'core');
  assert.equal(Object.keys(first.bridge.sourceHashes.roles).length, 5);
  const file = path.join(path.dirname(f.harnessRoot), 'core-plan.json');
  await writeFile(file, JSON.stringify(first));
  assert.equal(await main(['--apply', file], f.io), 0);
  assert.equal(JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/config.json'))).profile, 'core');
  f.output.stdout = '';
  assert.equal(await main(['--plan'], f.io), 0);
  assert.equal(JSON.parse(f.output.stdout).profile, 'core');
  f.output.stdout = '';
  assert.equal(await main(['--profile', 'all', '--plan'], f.io), 0);
  const update = JSON.parse(f.output.stdout);
  assert.equal(update.profile, 'all');
  await writeFile(file, JSON.stringify(update));
  f.output.stdout = '';
  assert.equal(await main(['--apply', file], f.io), 0);
  assert.doesNotMatch(f.output.stdout, /npm run init/);
});

test('interactive setup displays reviewed plan and writes only after exact hash confirmation', async t => {
  const f = await fixture(t);
  const input = new PassThrough();
  let output = '';
  const io = { harnessRoot: f.harnessRoot, stdin: input, stderr: f.io.stderr, stdout: { write(value) {
    output += value;
    if (value.includes('Project mode')) input.write('new\n');
    else if (value.includes('Target [')) input.write('\n');
    else if (value.includes('AI profile [')) input.write('\n');
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

test('interactive update offers saved profile and can change it', async t => {
  const f = await fixture(t);
  assert.equal(await main(['--mode', 'new', '--profile', 'core', '--plan'], f.io), 0);
  const file = path.join(path.dirname(f.harnessRoot), 'initial.json');
  await writeFile(file, f.output.stdout);
  assert.equal(await main(['--apply', file], f.io), 0);
  const input = new PassThrough();
  let output = '';
  const io = { harnessRoot: f.harnessRoot, stdin: input, stderr: f.io.stderr, stdout: { write(value) {
    output += value;
    if (value.includes('Target [')) input.write('codex\n');
    else if (value.includes('AI profile [')) input.write('all\n');
    else if (value.includes('Confirmation:')) {
      const digest = /"planSha256": "([a-f0-9]{64})"/.exec(output)?.[1];
      input.write(`apply ${digest?.slice(0, 12)}\n`);
    }
  } } };
  assert.equal(await main([], io), 0);
  assert.match(output, /AI profile \[all\/core\] \(core\):/);
  assert.equal(JSON.parse(await readFile(path.join(f.harnessRoot, '.harness/config.json'))).profile, 'all');
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
    else if (value.includes('AI profile [')) input.write('core\n');
    else if (value.includes('Confirmation:')) input.write('no\n');
  } } };
  assert.equal(await main([], io), 1);
  assert.match(output, /"mode": "existing"/);
  assert.match(output, /"target": "claude"/);
  assert.equal(await exists(path.join(f.harnessRoot, '.harness')), false);
  assert.equal(await exists(path.join(f.harnessRoot, 'project')), false);
});

test('standalone recover restores a displaced empty child and reports retained staging pointer', async t => {
  const f = await fixture(t);
  const projectRoot = path.join(f.harnessRoot, 'project');
  await mkdir(projectRoot);
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const transaction = path.join(f.harnessRoot, '.harness/staging', `${plan.setupId}-${randomUUID()}`);
  const displaced = path.join(transaction, 'empty-project');
  await mkdir(transaction, { recursive: true });
  await rename(projectRoot, displaced);
  const journal = path.join(f.harnessRoot, '.harness/setup-journal.json');
  await writeFile(journal, JSON.stringify({ schemaVersion: 1, setupId: plan.setupId, mode: 'new', phase: 'displacing-empty',
    projectRoot, destinationState: 'empty', target: 'claude', transaction,
    staged: path.join(transaction, 'project'), displaced, stagedFingerprint: null, ignoredDirectories: [] }));
  assert.equal(await main(['--recover', '--plan'], f.io), 1);
  assert.equal(await main(['--recover', '--apply', 'plan.json'], f.io), 1);
  assert.equal(await exists(projectRoot), false);
  assert.equal(JSON.parse(await readFile(journal)).phase, 'displacing-empty');
  f.output.stdout = '';
  assert.equal(await main(['--recover'], f.io), 0);
  const result = JSON.parse(f.output.stdout);
  assert.equal(result.phase, 'rolled-back');
  assert.equal(result.projectRoot, projectRoot);
  assert.equal(result.retainedStaging, transaction);
  assert.equal(await exists(projectRoot), true);
  assert.equal(await exists(path.join(projectRoot, '.git')), false);
  assert.equal(JSON.parse(await readFile(journal)).phase, 'rolled-back');
});

test('recover refuses unsupported journal phase without printing private payload or changing it', async t => {
  const f = await fixture(t);
  const projectRoot = path.join(f.harnessRoot, 'project');
  const plan = await planProjectSetup({ harnessRoot: f.harnessRoot, mode: 'new', target: 'claude' });
  const transaction = path.join(f.harnessRoot, '.harness/staging', `${plan.setupId}-${randomUUID()}`);
  await mkdir(transaction, { recursive: true });
  const journal = path.join(f.harnessRoot, '.harness/setup-journal.json');
  const bytes = JSON.stringify({ schemaVersion: 1, setupId: plan.setupId, mode: 'new', phase: 'bridge-applied',
    projectRoot, destinationState: 'absent', target: 'claude', transaction,
    staged: path.join(transaction, 'project'), displaced: path.join(transaction, 'empty-project'),
    stagedFingerprint: null, ignoredDirectories: [], privateNote: 'SECRET_JOURNAL_BODY' });
  await writeFile(journal, bytes);
  assert.equal(await main(['--recover'], f.io), 1);
  assert.match(f.output.stderr, /manual review/i);
  assert.doesNotMatch(f.output.stderr, /SECRET_JOURNAL_BODY/);
  assert.equal(await readFile(journal, 'utf8'), bytes);
});
