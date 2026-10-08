import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exportBundle } from '../harness/export-bundle.mjs';

const source = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function withTemporaryDirectory(fn) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'harness-export-'));
  try { await fn(parent); } finally { await rm(parent, { recursive: true, force: true }); }
}

test('exports four target candidates and only core roles/skills with auditable hashes', async () => {
  await withTemporaryDirectory(async parent => {
    const output = path.join(parent, 'bundle');
    const result = await exportBundle({ source, output, targets: 'all', profile: 'core' });
    assert.equal(result.output, output);
    const manifest = JSON.parse(await readFile(path.join(output, 'bundle-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.targets, ['codex', 'claude', 'opencode', 'antigravity']);
    assert.equal(manifest.profile, 'core');
    assert.equal(manifest.status, 'unverified');
    assert.equal(manifest.roleIds.length, 5);
    assert.equal(manifest.entries.filter(item => item.kind === 'role').length, 20);
    assert.equal(manifest.entries.filter(item => item.kind === 'skill').length, 10);
    for (const item of manifest.entries) {
      const body = await readFile(path.join(output, item.path));
      assert.equal(sha256(body), item.sha256, item.path);
    }
    const codexConfig = await readFile(path.join(output, '.codex/config.toml'), 'utf8');
    for (const roleId of manifest.roleIds) {
      assert.ok(codexConfig.includes(`[agents.${roleId}]`));
      assert.ok(codexConfig.includes(`config_file = "./agents/${roleId}.toml"`));
    }
    assert.match(await readFile(path.join(output, '.claude/agents/planner.md'), 'utf8'), /name: planner/);
    assert.match(await readFile(path.join(output, '.opencode/agents/planner.md'), 'utf8'), /mode: subagent/);
    assert.match(await readFile(path.join(output, '.agents/agents/planner/agent.md'), 'utf8'), /subagent: true/);
    assert.ok((await readFile(path.join(output, '.agents/skills/task-routing/profiles.md'), 'utf8')).length > 0);
    assert.equal(await readFile(path.join(output, '.claude/skills/task-routing/profiles.md'), 'utf8'),
      await readFile(path.join(output, '.agents/skills/task-routing/profiles.md'), 'utf8'));
    assert.ok(manifest.entries.some(item => item.path === '.claude/skills/task-routing/profiles.md'
      && item.target === 'claude' && item.kind === 'skill'));
    assert.deepEqual((await readdir(output)).filter(name => ['.ai', 'data', 'docker', 'harness'].includes(name)), []);
  });
});

test('all profile includes optional roles and complete skill reference directories', async () => {
  await withTemporaryDirectory(async parent => {
    const output = path.join(parent, 'bundle');
    await exportBundle({ source, output, targets: 'codex', profile: 'all' });
    const manifest = JSON.parse(await readFile(path.join(output, 'bundle-manifest.json'), 'utf8'));
    assert.equal(manifest.roleIds.length, 15);
    assert.ok(manifest.skillIds.includes('token-optimization'));
    assert.ok(manifest.entries.some(item => item.path === '.agents/skills/token-optimization/references/prompt-caching.md'));
    assert.equal(manifest.entries.filter(item => item.kind === 'role').length, 15);
    assert.ok(!manifest.entries.some(item => item.path.startsWith('.claude/')));
  });
});

test('refuses existing output, source overlap, relative paths, and symlink output parents', async () => {
  await withTemporaryDirectory(async parent => {
    const output = path.join(parent, 'bundle');
    await mkdir(output);
    await assert.rejects(exportBundle({ source, output, targets: 'codex', profile: 'core' }), /exist/i);
    await assert.rejects(exportBundle({ source, output: path.join(source, 'nested-bundle'), targets: 'codex', profile: 'core' }), /overlap|inside|nested/i);
    await assert.rejects(exportBundle({ source, output: 'relative-bundle', targets: 'codex', profile: 'core' }), /absolute/i);
    const link = path.join(parent, 'linked');
    try { await symlink(parent, link, 'dir'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
    await assert.rejects(exportBundle({ source, output: path.join(link, 'new'), targets: 'codex', profile: 'core' }), /symlink/i);
  });
});

test('rejects symlinked skill resources without creating a bundle', async () => {
  await withTemporaryDirectory(async parent => {
    const fixture = path.join(parent, 'engine');
    await mkdir(path.join(fixture, 'harness'), { recursive: true });
    await mkdir(path.join(fixture, '.agents'), { recursive: true });
    await cp(path.join(source, 'harness/agents'), path.join(fixture, 'harness/agents'), { recursive: true });
    await cp(path.join(source, 'harness/compatibility.json'), path.join(fixture, 'harness/compatibility.json'));
    await cp(path.join(source, '.agents/skills'), path.join(fixture, '.agents/skills'), { recursive: true });
    const target = path.join(fixture, '.agents/skills/task-routing/profiles.md');
    await rm(target);
    try { await symlink(path.join(source, '.agents/skills/task-routing/profiles.md'), target, 'file'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
    const output = path.join(parent, 'bundle');
    await assert.rejects(exportBundle({ source: fixture, output, targets: 'codex', profile: 'core' }), /symlink|unsupported file type/i);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  });
});

for (const linkedSource of ['harness/agents/planner.md', 'harness/compatibility.json']) {
  test(`rejects symlinked ${linkedSource} source without creating a bundle`, async t => {
    await withTemporaryDirectory(async parent => {
      const fixture = path.join(parent, 'engine');
      await mkdir(path.join(fixture, 'harness'), { recursive: true });
      await mkdir(path.join(fixture, '.agents'), { recursive: true });
      await cp(path.join(source, 'harness/agents'), path.join(fixture, 'harness/agents'), { recursive: true });
      await cp(path.join(source, 'harness/compatibility.json'), path.join(fixture, 'harness/compatibility.json'));
      await cp(path.join(source, '.agents/skills'), path.join(fixture, '.agents/skills'), { recursive: true });
      const target = path.join(fixture, linkedSource);
      await rm(target);
      try { await symlink(path.join(source, linkedSource), target, 'file'); }
      catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('file symlinks unavailable'); throw error; }
      const output = path.join(parent, 'bundle');
      await assert.rejects(exportBundle({ source: fixture, output, targets: 'codex', profile: 'core' }), /symlink/i);
      await assert.rejects(lstat(output), { code: 'ENOENT' });
    });
  });
}

test('rejects a linked canonical roles directory before reading its files', async () => {
  await withTemporaryDirectory(async parent => {
    const fixture = path.join(parent, 'engine');
    await mkdir(path.join(fixture, 'harness'), { recursive: true });
    await mkdir(path.join(fixture, '.agents'), { recursive: true });
    await cp(path.join(source, 'harness/compatibility.json'), path.join(fixture, 'harness/compatibility.json'));
    await cp(path.join(source, '.agents/skills'), path.join(fixture, '.agents/skills'), { recursive: true });
    try { await symlink(path.join(source, 'harness/agents'), path.join(fixture, 'harness/agents'), 'junction'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
    const output = path.join(parent, 'bundle');
    await assert.rejects(exportBundle({ source: fixture, output, targets: 'codex', profile: 'core' }), /symlink/i);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  });
});

test('rejects a linked harness directory before reading compatibility metadata', async () => {
  await withTemporaryDirectory(async parent => {
    const fixture = path.join(parent, 'engine');
    await mkdir(path.join(fixture, '.agents'), { recursive: true });
    await cp(path.join(source, '.agents/skills'), path.join(fixture, '.agents/skills'), { recursive: true });
    try { await symlink(path.join(source, 'harness'), path.join(fixture, 'harness'), 'junction'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
    const output = path.join(parent, 'bundle');
    await assert.rejects(exportBundle({ source: fixture, output, targets: 'codex', profile: 'core' }), /symlink/i);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  });
});

test('CLI exports a disposable Claude candidate and rejects a repeated export', async () => {
  await withTemporaryDirectory(async parent => {
    const output = path.join(parent, 'bundle');
    const args = ['scripts/export-target.mjs', '--source', source, '--output', output,
      '--targets', 'claude', '--profile', 'core'];
    const first = spawnSync(process.execPath, args, { cwd: source, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const report = JSON.parse(first.stdout);
    assert.deepEqual(report.manifest.targets, ['claude']);
    assert.match(await readFile(path.join(output, '.claude/agents/worker.md'), 'utf8'), /^---\n/);
    assert.ok((await readFile(path.join(output, '.claude/skills/task-routing/SKILL.md'), 'utf8')).length > 0);
    const repeated = spawnSync(process.execPath, args, { cwd: source, encoding: 'utf8' });
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /already exists/);
  });
});
