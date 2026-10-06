import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { adoptReviewed, makeGeneratedFile, planSync, recoverPartial } from '../harness/ownership.mjs';
import { loadRoles } from '../harness/inventory.mjs';
import { renderRole as renderCodexRole } from '../harness/targets/codex.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const ids = ['planner', 'worker', 'verifier', 'reviewer', 'goal-manager', 'context-curator', 'environment-doctor', 'impact-analyzer', 'integrator', 'performance-analyzer', 'preview-manager', 'release-manager', 'researcher', 'security-auditor', 'supervisor'];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'harness'), { recursive: true });
  await mkdir(path.join(root, '.codex/agents'), { recursive: true });
  await mkdir(path.join(root, 'project/records'), { recursive: true });
  const protectedFiles = {
    '.codex/config.toml': ids.map(id => `[agents.${id}]\ndescription = "old ${id}"\nconfig_file = "./agents/${id}.toml"\n`).join('\n'),
    '.codex/hooks.json': '{"hooks":true}\n',
    'AGENTS.md': '# Hand-owned root instructions\n',
    'project/records/objective.json': '{"status":"unchanged"}\n',
  };
  for (const [relative, bytes] of Object.entries(protectedFiles)) await writeFile(path.join(root, relative), bytes);
  const rendered = [], files = [];
  for (const id of ids) {
    const item = { path: `.codex/agents/${id}.toml`, target: 'codex', roleId: id,
      sourcePath: `harness/agents/${id}.md`, sourceSha256: sha(`source ${id}`), body: `name = "${id}"\n` };
    const old = `name = "${id}"\n# existing unmarked configuration\n`;
    await writeFile(path.join(root, item.path), old);
    rendered.push(item);
    files.push({ path: item.path, target: 'codex', roleId: id, sourcePath: item.sourcePath, configFile: `./agents/${id}.toml`, configDescription: `old ${id}`, oldSha256: sha(old), intendedNewDigest: makeGeneratedFile(item).entry.fileSha256, reviewerDecision: 'approved' });
  }
  return { root, rendered, record: { schemaVersion: 1, configSha256: sha(protectedFiles['.codex/config.toml']), files }, protectedFiles };
}

async function neutralFixture(t) {
  const data = await fixture(t);
  const missing = data.record.files.find(file => file.roleId === 'goal-manager');
  await rm(path.join(data.root, missing.path));
  const config = data.protectedFiles['.codex/config.toml'].replace(/\[agents\.goal-manager\][\s\S]*?(?=\n\[agents\.|$)/, '');
  await writeFile(path.join(data.root, '.codex/config.toml'), config);
  data.record = { schemaVersion: 2, configSha256: sha(config), files: data.record.files.map(file => file.roleId === 'goal-manager'
    ? { ...file, baselineState: 'absent', registrationState: 'absent', oldSha256: null,
      registrationReview: { configSha256: sha(config), reviewerDecision: 'approved' } }
    : { ...file, baselineState: 'existing', registrationState: 'registered' }) };
  return data;
}

async function cliFixture(t, nativeReady = true) {
  const synthetic = await fixture(t);
  const { root } = synthetic;
  const repository = path.resolve('.');
  for (const directory of ['harness/agents', '.agents/skills'])
    await cp(path.join(repository, directory), path.join(root, directory), { recursive: true });
  const compatibility = JSON.parse(await readFile(path.join(repository, 'harness/compatibility.json'), 'utf8'));
  if (nativeReady) compatibility.targets.codex.nativeSmoke = 'passed';
  await writeFile(path.join(root, 'harness/compatibility.json'), JSON.stringify(compatibility));
  const roles = await loadRoles(repository, 'all');
  const record = { ...synthetic.record, files: synthetic.record.files.map(file => {
    const role = roles.find(item => item.id === file.roleId);
    const rendered = renderCodexRole(role, { compatibility, profile: 'all' });
    return { ...file, sourcePath: role.sourcePath, codexReasoningEffort: role.codexReasoningEffort,
      intendedNewDigest: makeGeneratedFile({ ...rendered, target: 'codex', roleId: role.id,
        sourcePath: role.sourcePath, sourceSha256: role.sourceSha256 }).entry.fileSha256 };
  }) };
  const recordPath = path.join(root, 'reviewed.json');
  await writeFile(recordPath, JSON.stringify(record));
  const run = (...flags) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repository, 'scripts/sync.mjs'), '--root', root,
      '--targets', 'codex', '--profile', 'all', '--adopt-reviewed', recordPath, ...flags]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
  return { root, record, recordPath, run };
}

test('CLI adopts only explicitly reviewed fixture paths', async t => {
  const { root, record, run } = await cliFixture(t);
  const result = await run();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(new Set(JSON.parse(result.stdout).adoptedPaths), new Set(record.files.map(file => file.path)));
  assert.match(await readFile(path.join(root, record.files[0].path), 'utf8'), /^# @pure-harness-generated /);
});

test('CLI refuses reviewed adoption without native readiness before replacing hand-owned files', async t => {
  const { root, record, run } = await cliFixture(t, false);
  const before = await readFile(path.join(root, record.files[0].path));
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /native smoke.*unverified/i);
  assert.deepEqual(await readFile(path.join(root, record.files[0].path)), before);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('CLI keeps native readiness gate for reviewed recovery', async t => {
  const { root, record, run } = await cliFixture(t, false);
  const before = await readFile(path.join(root, record.files[0].path));
  const result = await run('--recover');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /native smoke.*unverified/i);
  assert.deepEqual(await readFile(path.join(root, record.files[0].path)), before);
});

test('CLI rejects missing reviewer decision without writes', async t => {
  const { root, record, recordPath, run } = await cliFixture(t);
  record.files[0].reviewerDecision = 'pending';
  await writeFile(recordPath, JSON.stringify(record));
  const before = await readFile(path.join(root, record.files[0].path));
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /reviewer decision/i);
  assert.deepEqual(await readFile(path.join(root, record.files[0].path)), before);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('CLI rejects baseline hash mismatch without writes', async t => {
  const { root, record, recordPath, run } = await cliFixture(t);
  record.files[0].oldSha256 = '0'.repeat(64);
  await writeFile(recordPath, JSON.stringify(record));
  const before = await readFile(path.join(root, record.files[0].path));
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /baseline hash/i);
  assert.deepEqual(await readFile(path.join(root, record.files[0].path)), before);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('CLI refuses an unreviewed colliding path', async t => {
  const { root, record, recordPath, run } = await cliFixture(t);
  const unreviewed = record.files.pop();
  await writeFile(recordPath, JSON.stringify(record));
  const before = await readFile(path.join(root, unreviewed.path));
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /invalid adoption inputs|does not name every rendered path/i);
  assert.deepEqual(await readFile(path.join(root, unreviewed.path)), before);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('CLI adoption flag cannot turn a dry run into a write', async t => {
  const { root, record, run } = await cliFixture(t);
  const before = await readFile(path.join(root, record.files[0].path));
  const result = await run('--dry-run');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot combine with other modes/i);
  assert.deepEqual(await readFile(path.join(root, record.files[0].path)), before);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('ordinary sync refuses all 15 unmarked Codex collisions and other target collisions', async t => {
  const { root, rendered } = await fixture(t);
  const codex = await planSync({ root, targets: ['codex'], profile: 'all', rendered, manifest: { entries: [] } });
  assert.equal(codex.writable, false);
  assert.equal(codex.actions.filter(action => action.kind === 'conflict').length, 15);
  for (const [target, relative] of [['claude', '.claude/agents/planner.md'], ['opencode', '.opencode/agents/planner.md'], ['antigravity', '.agents/agents/planner/agent.md']]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), 'human owned');
    const item = { ...rendered[0], path: relative, target };
    const plan = await planSync({ root, targets: [target], profile: 'all', rendered: [item], manifest: { entries: [] } });
    assert.equal(plan.actions[0].kind, 'conflict');
  }
});

test('adoption rejects baseline drift before writing any file', async t => {
  const { root, rendered, record } = await fixture(t);
  const changed = { ...record, files: record.files.map((file, index) => index ? file : { ...file, oldSha256: '0'.repeat(64) }) };
  await assert.rejects(adoptReviewed({ root, record: changed, rendered }), /baseline hash/i);
  assert.match(await readFile(path.join(root, record.files[0].path), 'utf8'), /existing unmarked/);
});

test('adoption requires explicit review for every named path', async t => {
  const { root, rendered, record } = await fixture(t);
  const changed = { ...record, files: record.files.map((file, index) => index ? file : { ...file, reviewerDecision: 'pending' }) };
  await assert.rejects(adoptReviewed({ root, record: changed, rendered }), /reviewer decision/i);
  assert.match(await readFile(path.join(root, record.files[0].path), 'utf8'), /existing unmarked/);
});

test('adoption rejects config drift even when all agent file hashes still match', async t => {
  const { root, rendered, record } = await fixture(t);
  await writeFile(path.join(root, '.codex/config.toml'), '[agents.planner]\nconfig_file = "./agents/other.toml"\n');
  await assert.rejects(adoptReviewed({ root, record, rendered }), /config.*hash/i);
  assert.match(await readFile(path.join(root, record.files[0].path), 'utf8'), /existing unmarked/);
});

test('adoption rejects misleading registration metadata despite matching config bytes', async t => {
  const { root, rendered, record } = await fixture(t);
  const changed = { ...record, files: record.files.map((file, index) => index ? file : { ...file, configDescription: 'misleading role' }) };
  await assert.rejects(adoptReviewed({ root, record: changed, rendered }), /config.*description|registration.*description/i);
  assert.match(await readFile(path.join(root, record.files[0].path), 'utf8'), /existing unmarked/);
});

test('stage has 15 canonical roles but no checked-in adoption baseline', async () => {
  const root = path.resolve('.');
  const roles = await loadRoles(root, 'all');
  assert.equal(roles.length, 15);
  await assert.rejects(readFile(path.join(root, 'harness/adoption/codex-baseline.json')), { code: 'ENOENT' });
  assert.equal((await readFile(path.join(root, '.codex/config.toml'), 'utf8')).includes('[agents.goal-manager]'), false);
});

test('reviewed adoption owns only named exact paths and preserves hand-owned bytes', async t => {
  const { root, rendered, record, protectedFiles } = await fixture(t);
  const selected = rendered.slice(0, 2), selectedRecord = { ...record, files: record.files.slice(0, 2) };
  const result = await adoptReviewed({ root, record: selectedRecord, rendered: selected });
  assert.deepEqual(result.adoptedPaths, selected.map(item => item.path));
  for (const item of selected) assert.match(await readFile(path.join(root, item.path), 'utf8'), /^# @pure-harness-generated /);
  assert.match(await readFile(path.join(root, rendered[2].path), 'utf8'), /existing unmarked/);
  for (const [relative, bytes] of Object.entries(protectedFiles)) assert.equal(await readFile(path.join(root, relative), 'utf8'), bytes);
  const config = await readFile(path.join(root, '.codex/config.toml'), 'utf8');
  assert.deepEqual([...config.matchAll(/^\[agents\.([\w-]+)\]$/gm)].map(match => match[1]), ids);
  const manifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.entries.map(entry => entry.path).sort(), selected.map(item => item.path).sort());
});

test('v2 review creates only the absent role and reports its manual registration review', async t => {
  const { root, rendered, record, protectedFiles } = await neutralFixture(t);
  const result = await adoptReviewed({ root, rendered, record });
  assert.equal(result.adoptedPaths.length, 15);
  assert.deepEqual(result.manualRegistrationReview, ['goal-manager']);
  assert.equal(await readFile(path.join(root, '.codex/config.toml'), 'utf8'), protectedFiles['.codex/config.toml'].replace(/\[agents\.goal-manager\][\s\S]*?(?=\n\[agents\.|$)/, ''));
  assert.match(await readFile(path.join(root, '.codex/agents/goal-manager.toml'), 'utf8'), /^# @pure-harness-generated /);
});

test('v2 review rejects an unexpected file at the reviewed absent path without writes', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  await writeFile(path.join(root, '.codex/agents/goal-manager.toml'), 'user owned\n');
  await assert.rejects(adoptReviewed({ root, rendered, record }), /absent|collision/i);
  assert.match(await readFile(path.join(root, record.files[0].path), 'utf8'), /existing unmarked/);
});

test('v2 creation requires an explicit human config review decision bound to the config hash', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  const unreviewed = { ...record, files: record.files.map(file => file.roleId === 'goal-manager'
    ? { ...file, registrationReview: undefined } : file) };
  await assert.rejects(adoptReviewed({ root, rendered, record: unreviewed }), /config review/i);
  const wrongHash = { ...record, files: record.files.map(file => file.roleId === 'goal-manager'
    ? { ...file, registrationReview: { ...file.registrationReview, configSha256: '0'.repeat(64) } } : file) };
  await assert.rejects(adoptReviewed({ root, rendered, record: wrongHash }), /config review.*hash/i);
  await assert.rejects(readFile(path.join(root, 'harness/.sync-journal.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('v2 manual review does not claim a TOML semantic absence', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  const configPath = path.join(root, '.codex/config.toml');
  const config = `${await readFile(configPath, 'utf8')}\n["ag\\U00000065nts"."goal-manager"]\nconfig_file = "./agents/goal-manager.toml"\n`;
  await writeFile(configPath, config);
  record.configSha256 = sha(config);
  record.files.find(file => file.roleId === 'goal-manager').registrationReview.configSha256 = sha(config);
  const result = await adoptReviewed({ root, rendered, record });
  assert.deepEqual(result.manualRegistrationReview, ['goal-manager']);
  assert.equal(await readFile(configPath, 'utf8'), config);
});

test('v2 review rejects an all-absent baseline before creating an unrecoverable journal', async t => {
  const { root, rendered, record } = await fixture(t);
  for (const file of record.files) await rm(path.join(root, file.path));
  await writeFile(path.join(root, '.codex/config.toml'), '');
  const allAbsent = { schemaVersion: 2, configSha256: sha(''), files: record.files.map(file => ({
    ...file, baselineState: 'absent', registrationState: 'absent', oldSha256: null,
    registrationReview: { configSha256: sha(''), reviewerDecision: 'approved' },
  })) };
  await assert.rejects(adoptReviewed({ root, rendered, record: allAbsent }), /all.absent|existing baseline/i);
  await assert.rejects(readFile(path.join(root, 'harness/.sync-journal.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, rendered[0].path)), { code: 'ENOENT' });
});

test('reviewed recovery completes a partial mixed adopt/create journal and ordinary recovery stays closed', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  await assert.rejects(adoptReviewed({ root, rendered, record,
    beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('interrupted'); },
  }), /interrupted/);
  const ordinary = await recoverPartial({ root, targets: ['codex'] });
  assert.equal(ordinary.partialFailure, true);
  const reviewed = await recoverPartial({ root, targets: ['codex'], record, rendered });
  assert.equal(reviewed.partialFailure, false, reviewed.error);
  assert.deepEqual(reviewed.changedPaths, ['harness/generated-manifest.json']);
  assert.deepEqual(reviewed.manualRegistrationReview, ['goal-manager']);
  assert.equal(JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json'))).entries.length, 15);
});

test('CLI reviewed recovery reports the goal-manager manual registration review', async t => {
  const { root, record, recordPath, run } = await cliFixture(t);
  const missing = record.files.find(file => file.roleId === 'goal-manager');
  await rm(path.join(root, missing.path));
  const configPath = path.join(root, '.codex/config.toml');
  const config = (await readFile(configPath, 'utf8')).replace(/\[agents\.goal-manager\][\s\S]*?(?=\n\[agents\.|$)/, '');
  await writeFile(configPath, config);
  const reviewed = { ...record, schemaVersion: 2, configSha256: sha(config), files: record.files.map(file => file.roleId === 'goal-manager'
    ? { ...file, baselineState: 'absent', registrationState: 'absent', oldSha256: null,
      registrationReview: { configSha256: sha(config), reviewerDecision: 'approved' } }
    : { ...file, baselineState: 'existing', registrationState: 'registered' }) };
  await writeFile(recordPath, JSON.stringify(reviewed));
  const compatibility = JSON.parse(await readFile(path.join(root, 'harness/compatibility.json'), 'utf8'));
  const roles = await loadRoles(root, 'all');
  const rendered = roles.map(role => ({ ...renderCodexRole(role, { compatibility, profile: 'all' }), target: 'codex',
    roleId: role.id, sourcePath: role.sourcePath, sourceSha256: role.sourceSha256 }));
  await assert.rejects(adoptReviewed({ root, record: reviewed, rendered,
    beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('interrupted'); },
  }), /interrupted/);
  const result = await run('--recover');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).manualRegistrationReview, ['goal-manager']);
  assert.equal(await readFile(configPath, 'utf8'), config);
});

test('reviewed recovery rejects a mismatched record and a tampered journal without writes', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  await assert.rejects(adoptReviewed({ root, rendered, record,
    beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('interrupted'); },
  }), /interrupted/);
  const journalPath = path.join(root, 'harness/.sync-journal.json');
  const original = await readFile(journalPath, 'utf8');
  const badRecord = { ...record, files: record.files.map(file => file.roleId === 'worker' ? { ...file, intendedNewDigest: '0'.repeat(64) } : file) };
  const mismatch = await recoverPartial({ root, targets: ['codex'], record: badRecord, rendered });
  assert.equal(mismatch.partialFailure, true);
  assert.deepEqual(mismatch.changedPaths, []);
  const journal = JSON.parse(original);
  journal.actions[0].beforeFile = 'unreviewed replacement';
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  const tampered = await recoverPartial({ root, targets: ['codex'], record, rendered });
  assert.equal(tampered.partialFailure, true);
  assert.deepEqual(tampered.changedPaths, []);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('ordinary recovery rejects action-kind laundering of an adoption journal', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  await assert.rejects(adoptReviewed({ root, rendered, record,
    beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('interrupted'); },
  }), /interrupted/);
  const journalPath = path.join(root, 'harness/.sync-journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  for (const action of journal.actions) if (action.kind === 'adopt') {
    action.kind = 'create';
    action.beforeFile = null;
  }
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  const result = await recoverPartial({ root, targets: ['codex'] });
  assert.equal(result.partialFailure, true);
  assert.deepEqual(result.changedPaths, []);
  assert.match(result.error, /review|legacy|journal/i);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
  assert.equal((await readFile(journalPath, 'utf8')).length > 0, true);
});

test('reviewed recovery requires the exact approved record, not a hash-equivalent substitute', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  await assert.rejects(adoptReviewed({ root, rendered, record,
    beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('interrupted'); },
  }), /interrupted/);
  const substitute = { ...record, status: 'different reviewed document' };
  const result = await recoverPartial({ root, targets: ['codex'], record: substitute, rendered });
  assert.equal(result.partialFailure, true);
  assert.deepEqual(result.changedPaths, []);
  assert.match(result.error, /record|digest/i);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});

test('reviewed recovery resumes after one output without rewriting that completed output', async t => {
  const { root, rendered, record } = await neutralFixture(t);
  let outputWrites = 0;
  await assert.rejects(adoptReviewed({ root, rendered, record, beforeWrite: relative => {
    if (relative.startsWith('.codex/agents/') && ++outputWrites === 2) throw new Error('interrupted');
  } }), /interrupted/);
  const first = '.codex/agents/context-curator.toml';
  const completed = await readFile(path.join(root, first));
  const result = await recoverPartial({ root, targets: ['codex'], record, rendered });
  assert.equal(result.partialFailure, false, result.error);
  assert.equal(result.changedPaths.includes(first), false);
  assert.deepEqual(await readFile(path.join(root, first)), completed);
  assert.equal(JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json'))).entries.length, 15);
});

test('interrupted reviewed adoption cannot recover without renewed review evidence', async t => {
  const { root, rendered, record } = await fixture(t);
  const item = rendered[0], selectedRecord = { ...record, files: record.files.slice(0, 1) };
  await assert.rejects(adoptReviewed({ root, record: selectedRecord, rendered: [item],
    beforeWrite: relative => { if (relative === 'harness/generated-manifest.json') throw new Error('injected adoption interruption'); },
  }), /injected adoption interruption/);
  const journal = await readFile(path.join(root, 'harness/.sync-journal.json'), 'utf8');
  const recovered = await recoverPartial({ root, targets: ['codex'] });
  assert.equal(recovered.partialFailure, true);
  assert.match(recovered.error, /adopt.*review/i);
  assert.deepEqual(recovered.changedPaths, []);
  assert.equal(await readFile(path.join(root, 'harness/.sync-journal.json'), 'utf8'), journal);
  assert.match(await readFile(path.join(root, item.path), 'utf8'), /^# @pure-harness-generated /);
  assert.match(await readFile(path.join(root, rendered[1].path), 'utf8'), /existing unmarked/);
});

test('a copied adopt journal cannot replace an unrelated unmarked Codex file', async t => {
  const { root, rendered } = await fixture(t);
  const item = rendered[1], { file, entry } = makeGeneratedFile(item);
  const beforeFile = await readFile(path.join(root, item.path), 'utf8');
  const journal = { version: 1, targets: ['codex'], manifestBefore: null,
    manifestAfter: `${JSON.stringify({ entries: [entry] }, null, 2)}\n`, actions: [{ kind: 'adopt', path: item.path,
      target: 'codex', before: null, after: entry, beforeFile, afterFile: file }] };
  await writeFile(path.join(root, 'harness/.sync-journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  const result = await recoverPartial({ root, targets: ['codex'] });
  assert.equal(result.partialFailure, true);
  assert.match(result.error, /adopt.*review/i);
  assert.deepEqual(result.changedPaths, []);
  assert.equal(await readFile(path.join(root, item.path), 'utf8'), beforeFile);
  await assert.rejects(readFile(path.join(root, 'harness/generated-manifest.json')), { code: 'ENOENT' });
});
