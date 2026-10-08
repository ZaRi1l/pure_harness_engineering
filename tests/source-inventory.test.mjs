import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectSetupSource, assertSafeSetupDestination } from '../harness/source-inventory.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'silo-inventory-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const harnessRoot = path.join(base, 'harness');
  const source = path.join(base, 'source');
  await mkdir(harnessRoot);
  await mkdir(source);
  git(source, 'init', '-q');
  git(source, 'config', 'user.name', 'Fixture');
  git(source, 'config', 'user.email', 'fixture@example.test');
  return { base, harnessRoot, source };
}

async function snapshotTree(root) {
  const entries = [];
  async function visit(dir, relative = '') {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const rel = path.posix.join(relative, item.name);
      if (item.isDirectory()) await visit(path.join(dir, item.name), rel);
      else entries.push([rel, hash(await readFile(path.join(dir, item.name)))]);
    }
  }
  await visit(root);
  return entries.sort((a, b) => a[0].localeCompare(b[0]));
}

test('local inventory fingerprints Git and file metadata without exposing bodies or changing source', async t => {
  const { harnessRoot, source } = await fixture(t);
  await mkdir(path.join(source, '.ai', 'runtime'), { recursive: true });
  await mkdir(path.join(source, '.agents', 'skills'), { recursive: true });
  await writeFile(path.join(source, '.gitignore'), 'ignored.txt\n');
  await writeFile(path.join(source, 'README.md'), 'first\n');
  await writeFile(path.join(source, '.agents', 'skills', 'generic.md'), 'Reusable agent testing instructions\n');
  await writeFile(path.join(source, '.ai', 'runtime', 'private.json'), 'SECRET_SENTINEL');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'fixture');
  git(source, 'remote', 'add', 'origin', 'https://user:password@example.test/project.git');
  await writeFile(path.join(source, 'README.md'), 'second\n');
  await writeFile(path.join(source, 'untracked.txt'), 'new\n');
  await writeFile(path.join(source, 'ignored.txt'), 'ignored\n');
  const before = await snapshotTree(source);
  const report = await inspectSetupSource({ harnessRoot, mode: 'existing', source });
  const byPath = Object.fromEntries(report.files.map(file => [file.path, file]));
  assert.equal(report.kind, 'local');
  assert.equal(report.git.head, git(source, 'rev-parse', 'HEAD'));
  assert.equal(report.git.dirty, true);
  assert.equal(byPath['README.md'].gitClass, 'modified');
  assert.equal(byPath['README.md'].sha256, hash('second\n'));
  assert.equal(byPath['untracked.txt'].gitClass, 'untracked');
  assert.equal(byPath['ignored.txt'].gitClass, 'ignored');
  assert.equal(byPath['.ai/runtime/private.json'].classification, 'private-runtime');
  assert.equal(byPath['.agents/skills/generic.md'].classification, 'generic');
  assert.equal(report.git.remotes[0].name, 'origin');
  assert.equal(JSON.stringify(report).includes('password'), false);
  assert.equal(JSON.stringify(report).includes('SECRET_SENTINEL'), false);
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(await snapshotTree(source), before);
});

test('remote inspection pins HEAD without fetching content or creating destination', async t => {
  const { base, harnessRoot, source } = await fixture(t);
  await writeFile(path.join(source, 'README.md'), 'remote\n');
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'fixture');
  const url = 'https://fixture.invalid/source.git';
  const sshUrl = 'ssh://git@fixture.invalid/source.git';
  const configNames = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1'];
  const previous = Object.fromEntries(configNames.map(name => [name, process.env[name]]));
  process.env.GIT_CONFIG_COUNT = '2';
  process.env.GIT_CONFIG_KEY_0 = 'url.file:///' + source.replaceAll('\\', '/') + '.insteadOf'; process.env.GIT_CONFIG_VALUE_0 = url;
  process.env.GIT_CONFIG_KEY_1 = process.env.GIT_CONFIG_KEY_0; process.env.GIT_CONFIG_VALUE_1 = sshUrl;
  try {
    const report = await inspectSetupSource({ harnessRoot, mode: 'existing', source: url });
    assert.equal(report.kind, 'remote');
    assert.equal(report.git.head, git(source, 'rev-parse', 'HEAD'));
    assert.deepEqual(report.files, []);
    assert.ok(report.warnings.includes('remote-content-not-yet-inspected'));
    const sshReport = await inspectSetupSource({ harnessRoot, mode: 'existing', source: sshUrl });
    assert.equal(sshReport.git.head, report.git.head);
    await assert.rejects(() => import('node:fs/promises').then(fs => fs.stat(path.join(harnessRoot, 'project'))), /ENOENT/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('rejects unsafe source, destination, and ambiguous content', async t => {
  const { base, harnessRoot, source } = await fixture(t);
  await writeFile(path.join(source, 'README.md'), 'first\n'); git(source, 'add', '.'); git(source, 'commit', '-qm', 'fixture');
  await assert.rejects(inspectSetupSource({ harnessRoot, mode: 'existing', source: harnessRoot }), /overlap|Git root/i);
  await assert.rejects(assertSafeSetupDestination({ harnessRoot, destination: path.join(base, 'outside') }), /destination|project/i);
  await assert.rejects(inspectSetupSource({ harnessRoot, mode: 'existing', source: 'https://user:secret@example.test/x.git' }), /credential|remote/i);
  const linked = path.join(base, 'linked'); git(source, 'worktree', 'add', '-qb', 'linked', linked);
  await assert.rejects(inspectSetupSource({ harnessRoot, mode: 'existing', source: linked }), /worktree|\.git/i);
  const escape = path.join(base, 'escape'); await symlink(escape, path.join(harnessRoot, 'project'), 'junction');
  await assert.rejects(assertSafeSetupDestination({ harnessRoot, destination: path.join(harnessRoot, 'project') }), /link|reparse|destination/i);
});

test('keeps secret-bearing and mixed configuration out of generic classification', async t => {
  const { harnessRoot, source } = await fixture(t);
  await mkdir(path.join(source, '.codex'));
  await writeFile(path.join(source, '.codex', 'config.toml'), 'api_key = "SECRET_SENTINEL"\n');
  await writeFile(path.join(source, '.codex', 'AGENTS.md'), 'Agent skill instructions for the customer project\n');
  const report = await inspectSetupSource({ harnessRoot, mode: 'existing', source });
  const byPath = Object.fromEntries(report.files.map(file => [file.path, file]));
  assert.equal(byPath['.codex/config.toml'].classification, 'private-runtime');
  assert.equal(byPath['.codex/AGENTS.md'].classification, 'mixed');
  assert.equal(JSON.stringify(report).includes('SECRET_SENTINEL'), false);
});

test('rejects case-colliding destination and external source links', async t => {
  const { base, harnessRoot, source } = await fixture(t);
  await mkdir(path.join(harnessRoot, 'Project'));
  await assert.rejects(assertSafeSetupDestination({ harnessRoot, destination: path.join(harnessRoot, 'project') }), /case-colliding/i);
  await mkdir(path.join(base, 'outside'));
  await symlink(path.join(base, 'outside'), path.join(source, 'link'), 'junction');
  await assert.rejects(inspectSetupSource({ harnessRoot, mode: 'existing', source }), /link|reparse/i);
});
