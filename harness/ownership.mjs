import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRelativePath } from './schema.mjs';
import { RENDERER_VERSION } from './generated-syntax.mjs';

const manifestPath = 'harness/generated-manifest.json';
const journalPath = 'harness/.sync-journal.json';
const lockPath = 'harness/.sync.lock';
const roots = { codex: '.codex/agents', claude: '.claude/agents', opencode: '.opencode/agents', antigravity: '.agents/agents' };
const fields = ['path', 'target', 'roleId', 'sourcePath', 'sourceSha256', 'rendererVersion', 'bodySha256', 'fileSha256'];
const headerFields = ['generator', 'schemaVersion', 'sourcePath', 'sourceSha256', 'rendererVersion', 'bodySha256'];
const sha = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a.target.localeCompare(b.target) || a.path.localeCompare(b.path);

function checkPath(relative, target, seen) {
  if (!Object.hasOwn(roots, target)) throw new Error(`unknown target: ${target}`);
  return assertSafeRelativePath(relative, roots[target], seen);
}
function checkDeclaredPath(relative, target, roleId) {
  const expected = target === 'antigravity' ? `${roots[target]}/${roleId}/agent.md`
    : `${roots[target]}/${roleId}.${target === 'codex' ? 'toml' : 'md'}`;
  if (relative !== expected) throw new Error(`undeclared output path: ${relative}`);
}
function validateEntry(entry, seen) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join() !== [...fields].sort().join()) throw new Error('invalid manifest entry schema');
  for (const field of fields) if (typeof entry[field] !== 'string' || !entry[field]) throw new Error(`invalid manifest ${field}`);
  checkPath(entry.path, entry.target, seen);
  checkDeclaredPath(entry.path, entry.target, entry.roleId);
  assertSafeRelativePath(entry.sourcePath, 'harness/agents');
  if (entry.sourcePath !== `harness/agents/${entry.roleId}.md`) throw new Error('invalid manifest sourcePath');
  for (const field of ['sourceSha256', 'bodySha256', 'fileSha256']) if (!/^[a-f0-9]{64}$/.test(entry[field])) throw new Error(`invalid manifest ${field}`);
  if (entry.rendererVersion !== RENDERER_VERSION) throw new Error('invalid manifest rendererVersion');
  return entry;
}
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).join() !== 'entries' || !Array.isArray(manifest.entries)) throw new Error('invalid manifest schema');
  const seen = new Set();
  const entries = manifest.entries.map(entry => validateEntry(entry, seen));
  if (entries.some((entry, i) => i && compare(entries[i - 1], entry) >= 0)) throw new Error('manifest entries must be sorted by target/path');
  return entries;
}
export function makeGeneratedFile(item) {
  if (!item || typeof item.body !== 'string' || typeof item.roleId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(item.roleId)) throw new Error('invalid rendered item');
  checkPath(item.path, item.target);
  checkDeclaredPath(item.path, item.target, item.roleId);
  assertSafeRelativePath(item.sourcePath, 'harness/agents');
  if (item.sourcePath !== `harness/agents/${item.roleId}.md`) throw new Error('invalid sourcePath');
  if (!/^[a-f0-9]{64}$/.test(item.sourceSha256)) throw new Error('invalid sourceSha256');
  const bodySha256 = sha(item.body);
  const header = { generator: 'pure-harness', schemaVersion: 1, sourcePath: item.sourcePath, sourceSha256: item.sourceSha256, rendererVersion: RENDERER_VERSION, bodySha256 };
  const prefix = item.target === 'codex' ? `# @pure-harness-generated ${JSON.stringify(header)}\n` : `<!-- @pure-harness-generated ${JSON.stringify(header)} -->\n`;
  const file = prefix + item.body;
  return { file, entry: { path: item.path, target: item.target, roleId: item.roleId, sourcePath: item.sourcePath, sourceSha256: item.sourceSha256, rendererVersion: RENDERER_VERSION, bodySha256, fileSha256: sha(file) } };
}
export function parseGeneratedFile(target, file, entry) {
  const match = target === 'codex' ? /^# @pure-harness-generated ([^\r\n]+)\n/.exec(file) : /^<!-- @pure-harness-generated ([^\r\n]+) -->\n/.exec(file);
  if (!match) throw new Error('missing or malformed ownership header');
  let header;
  try { header = JSON.parse(match[1]); } catch { throw new Error('malformed ownership header JSON'); }
  if (!header || Object.keys(header).join() !== headerFields.join() || header.generator !== 'pure-harness' || header.schemaVersion !== 1) throw new Error('invalid ownership header schema or generator');
  if (JSON.stringify(header) !== match[1]) throw new Error('noncanonical ownership header');
  if (entry) for (const field of headerFields.slice(2)) if (header[field] !== entry[field]) throw new Error(`ownership header ${field} mismatch`);
  const body = file.slice(match[0].length);
  if (sha(body) !== header.bodySha256) throw new Error('ownership bodySha256 mismatch');
  return { body, header };
}
async function metadata(absolute) {
  try { return await lstat(absolute); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function safeAbsolute(root, relative) {
  const base = path.resolve(root);
  let current = base;
  if ((await metadata(base))?.isSymbolicLink()) throw new Error(`symlink root: ${base}`);
  for (const part of relative.split('/')) {
    const parent = current;
    const parentMeta = await metadata(parent);
    if (parentMeta && !parentMeta.isDirectory()) throw new Error(`non-directory ancestor: ${relative}`);
    if (parentMeta) {
      const names = await readdir(parent);
      const collision = names.find(name => name.toLowerCase() === part.toLowerCase() && name !== part);
      if (collision) throw new Error(`case collision: ${relative}`);
    }
    current = path.join(current, part);
    const meta = await metadata(current);
    if (meta?.isSymbolicLink()) throw new Error(`symlink in output path: ${relative}`);
  }
  if (!current.startsWith(`${base}${path.sep}`)) throw new Error(`path escapes root: ${relative}`);
  return current;
}
async function currentOwned(root, entry) {
  const absolute = await safeAbsolute(root, entry.path);
  const meta = await metadata(absolute);
  if (!meta?.isFile()) throw new Error('owned output missing or not a file');
  const file = await readFile(absolute, 'utf8');
  if (sha(file) !== entry.fileSha256) throw new Error('fileSha256 drift');
  parseGeneratedFile(entry.target, file, entry);
  return file;
}
export async function planSync({ root, targets, profile, rendered, manifest }) {
  if (!path.isAbsolute(root) || !['core', 'all'].includes(profile) || !Array.isArray(targets) || !targets.length || !Array.isArray(rendered)) throw new Error('invalid sync inputs');
  if (new Set(targets).size !== targets.length || targets.some(target => !Object.hasOwn(roots, target))) throw new Error('invalid targets');
  const prior = validateManifest(manifest);
  await safeAbsolute(root, journalPath);
  if (await metadata(path.join(root, journalPath))) throw new Error('pending recovery journal; run sync --recover before planning');
  await safeAbsolute(root, manifestPath);
  const diskManifest = await metadata(path.join(root, manifestPath));
  const manifestBytes = diskManifest ? await readFile(path.join(root, manifestPath), 'utf8') : null;
  if (diskManifest) {
    if (!diskManifest.isFile()) throw new Error('manifest is not a file');
    const disk = JSON.parse(manifestBytes);
    if (JSON.stringify(disk) !== JSON.stringify(manifest)) throw new Error('manifest differs from on-disk manifest');
  } else if (prior.length) throw new Error('missing on-disk manifest');
  const desired = new Map();
  for (const item of rendered) {
    if (!targets.includes(item.target)) throw new Error(`unselected rendered target: ${item.target}`);
    checkPath(item.path, item.target);
    if (desired.has(item.path.toLowerCase())) throw new Error(`case collision: ${item.path}`);
    desired.set(item.path.toLowerCase(), makeGeneratedFile(item));
  }
  const old = new Map(prior.map(entry => [entry.path.toLowerCase(), entry]));
  const actions = [];
  for (const [key, generated] of desired) {
    const entry = generated.entry;
    const before = old.get(key);
    let kind, reason;
    try {
      if (before && before.path !== entry.path) throw new Error('case collision with manifest');
      const absolute = await safeAbsolute(root, entry.path);
      const meta = await metadata(absolute);
      if (!before) { if (meta) throw new Error('unowned output collision'); kind = 'create'; }
      else {
        await currentOwned(root, before);
        kind = before.fileSha256 === entry.fileSha256 && JSON.stringify(before) === JSON.stringify(entry) ? 'unchanged' : 'update';
      }
    } catch (error) { kind = 'conflict'; reason = error.message; }
    actions.push({ path: entry.path, target: entry.target, roleId: entry.roleId, kind, reason, before, after: entry, file: generated.file });
  }
  for (const entry of prior) {
    if (!targets.includes(entry.target) || desired.has(entry.path.toLowerCase())) continue;
    let kind = 'prune', reason;
    try { await currentOwned(root, entry); } catch (error) { kind = 'conflict'; reason = error.message; }
    actions.push({ path: entry.path, target: entry.target, roleId: entry.roleId, kind, reason, before: entry });
  }
  actions.sort(compare);
  const next = [
    ...prior.filter(entry => !targets.includes(entry.target)),
    ...actions.filter(action => action.kind !== 'prune' && action.kind !== 'conflict').map(action => action.after),
  ].sort(compare);
  const manifestText = `${JSON.stringify({ entries: next }, null, 2)}\n`;
  const manifestDirty = manifestBytes !== manifestText;
  return { root, actions, prior, manifestBytes, manifestText, manifestExisted: !!diskManifest, manifestDirty, writable: !actions.some(action => action.kind === 'conflict'), targets, profile };
}
function configRegistration(config, roleId) {
  const section = new RegExp(`^\\[agents\\.${roleId}\\]\\r?\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'gm');
  const matches = [...config.matchAll(section)];
  if (matches.length !== 1) throw new Error(`missing or duplicate config registration: ${roleId}`);
  const value = key => {
    const assignments = [...matches[0][1].matchAll(new RegExp(`^${key} = ("(?:[^"\\\\]|\\\\.)*")\\r?$`, 'gm'))];
    if (assignments.length !== 1) throw new Error(`missing or duplicate config ${key}: ${roleId}`);
    return JSON.parse(assignments[0][1]);
  };
  return { description: value('description'), configFile: value('config_file') };
}
async function reviewedIntent(root, record, rendered) {
  if (!path.isAbsolute(root) || !record || ![1, 2].includes(record.schemaVersion) || !Array.isArray(record.files)
      || !record.files.length || !Array.isArray(rendered) || rendered.length !== record.files.length
      || !/^[a-f0-9]{64}$/.test(record.configSha256)) throw new Error('invalid adoption inputs');
  const configBytes = await readFile(await safeAbsolute(root, '.codex/config.toml'));
  if (sha(configBytes) !== record.configSha256) throw new Error('config baseline hash mismatch');
  const configText = configBytes.toString('utf8');
  const proposed = new Map();
  for (const item of rendered) {
    const generated = makeGeneratedFile(item);
    if (item.target !== 'codex' || proposed.has(item.path)) throw new Error('invalid or duplicate adoption target');
    proposed.set(item.path, generated);
  }
  const reviewed = new Map();
  const manualRegistrationReview = [];
  for (const file of record.files) {
    if (!file || file.target !== 'codex' || typeof file.path !== 'string' || typeof file.roleId !== 'string'
        || typeof file.sourcePath !== 'string' || typeof file.configFile !== 'string' || typeof file.configDescription !== 'string'
        || !/^[a-f0-9]{64}$/.test(file.intendedNewDigest)) throw new Error('invalid adoption record');
    const state = record.schemaVersion === 1 ? 'existing' : file.baselineState;
    if (!['existing', 'absent'].includes(state)
        || (state === 'existing' ? !/^[a-f0-9]{64}$/.test(file.oldSha256) : file.oldSha256 !== null)
        || (record.schemaVersion === 2 && !['registered', 'absent'].includes(file.registrationState))) throw new Error('invalid adoption record state');
    if (file.reviewerDecision !== 'approved') throw new Error(`missing approved reviewer decision: ${file.path}`);
    const generated = proposed.get(file.path);
    if (!generated || reviewed.has(file.path) || generated.entry.roleId !== file.roleId
        || generated.entry.sourcePath !== file.sourcePath || file.configFile !== `./agents/${file.roleId}.toml`
        || generated.entry.fileSha256 !== file.intendedNewDigest) throw new Error(`adoption record/output mismatch: ${file.path}`);
    if (record.schemaVersion === 2 && file.registrationState === 'absent') {
      const review = file.registrationReview;
      if (!review || typeof review !== 'object' || Array.isArray(review)
          || Object.keys(review).sort().join() !== 'configSha256,reviewerDecision'
          || review.reviewerDecision !== 'approved') throw new Error(`approved config review required: ${file.roleId}`);
      if (review.configSha256 !== record.configSha256) throw new Error(`config review hash mismatch: ${file.roleId}`);
      manualRegistrationReview.push(file.roleId);
    } else {
      const registration = configRegistration(configText, file.roleId);
      if (registration.description !== file.configDescription || registration.configFile !== file.configFile) throw new Error(`config registration description/path mismatch: ${file.roleId}`);
    }
    reviewed.set(file.path, { file, generated, state });
  }
  if (reviewed.size !== proposed.size) throw new Error('adoption record does not name every rendered path');
  if (![...reviewed.values()].some(intent => intent.state === 'existing'))
    throw new Error('all-absent reviewed adoption is unsupported; use ordinary sync');
  return { reviewed, manualRegistrationReview };
}
export async function adoptReviewed({ root, record, rendered, beforeWrite }) {
  const { reviewed, manualRegistrationReview } = await reviewedIntent(root, record, rendered);
  const oldBytes = new Map();
  for (const [relative, { file, state }] of reviewed) {
    const absolute = await safeAbsolute(root, relative);
    const meta = await metadata(absolute);
    if (state === 'absent') {
      if (meta) throw new Error(`reviewed absent path collision: ${relative}`);
      continue;
    }
    if (!meta?.isFile()) throw new Error(`baseline file missing: ${relative}`);
    const raw = await readFile(absolute);
    const bytes = raw.toString('utf8');
    if (!Buffer.from(bytes, 'utf8').equals(raw)) throw new Error(`baseline file is not UTF-8: ${relative}`);
    if (sha(raw) !== file.oldSha256) throw new Error(`baseline hash mismatch: ${relative}`);
    oldBytes.set(relative, bytes);
  }
  let manifest;
  try { manifest = JSON.parse(await readFile(await safeAbsolute(root, manifestPath), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; manifest = { entries: [] }; }
  const plan = await planSync({ root, targets: ['codex'], profile: 'all', rendered, manifest });
  if (plan.actions.length !== reviewed.size || plan.actions.some(action => {
    const state = reviewed.get(action.path)?.state;
    return state === 'existing' ? action.kind !== 'conflict' || action.reason !== 'unowned output collision' : action.kind !== 'create';
  })) throw new Error('adoption preflight conflict');
  for (const action of plan.actions) {
    if (reviewed.get(action.path).state === 'existing') {
      action.kind = 'adopt';
      action.reason = undefined;
      action.beforeFile = oldBytes.get(action.path);
    }
  }
  plan.manifestText = `${JSON.stringify({ entries: [...plan.prior, ...plan.actions.map(action => action.after)].sort(compare) }, null, 2)}\n`;
  plan.manifestDirty = plan.manifestBytes !== plan.manifestText;
  plan.writable = true;
  plan.adoptionConfigSha256 = record.configSha256;
  plan.reviewedRecordSha256 = sha(JSON.stringify(record));
  const result = await applyPlan(plan, { beforeWrite });
  if (result.partialFailure) throw new Error(`adoption failed; changed paths: ${result.changedPaths.join(', ')}; ${result.error}`);
  return { adoptedPaths: plan.actions.map(action => action.path), manualRegistrationReview };
}
async function atomicWrite(absolute, content) {
  const temp = `${absolute}.${randomUUID()}.tmp`;
  try { await writeFile(temp, content, { flag: 'wx' }); await rename(temp, absolute); }
  finally { try { await unlink(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
async function acquireRootLock(root) {
  const absolute = await safeAbsolute(root, lockPath);
  const token = `${process.pid}:${randomUUID()}`;
  let handle;
  try {
    handle = await open(absolute, 'wx');
    await handle.writeFile(token);
    await handle.sync();
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('sync lock exists; verify no writer is active before manual stale-lock removal');
    throw error;
  } finally { await handle?.close(); }
  return async () => {
    await safeAbsolute(root, lockPath);
    if (await readFile(absolute, 'utf8') !== token) throw new Error('sync lock ownership changed; refusing release');
    await unlink(absolute);
  };
}
export async function applyPlan(plan, { beforeWrite } = {}) {
  if (!plan?.writable) throw new Error('sync plan has conflict');
  const changedPaths = [];
  let releaseLock;
  try {
    releaseLock = await acquireRootLock(plan.root);
    await safeAbsolute(plan.root, journalPath);
    if (await metadata(path.join(plan.root, journalPath))) throw new Error('pending recovery journal');
    await safeAbsolute(plan.root, manifestPath);
    const manifestMeta = await metadata(path.join(plan.root, manifestPath));
    const currentManifest = manifestMeta ? await readFile(path.join(plan.root, manifestPath), 'utf8') : null;
    if (currentManifest !== plan.manifestBytes) throw new Error('manifest changed after planning');
    const checkAdoptionConfig = async () => {
      if (plan.adoptionConfigSha256 && sha(await readFile(await safeAbsolute(plan.root, '.codex/config.toml'))) !== plan.adoptionConfigSha256)
        throw new Error('config baseline hash changed during adoption');
    };
    await checkAdoptionConfig();
    // Complete preflight for every selected target before recording intent or changing output.
    for (const target of plan.targets) {
      const actions = plan.actions.filter(action => action.target === target);
      for (const action of actions) {
        const absolute = await safeAbsolute(plan.root, action.path);
        if (action.kind === 'create' && await metadata(absolute)) throw new Error(`unowned output collision: ${action.path}`);
        if (action.kind === 'adopt' && await readFile(absolute, 'utf8') !== action.beforeFile) throw new Error(`baseline hash changed: ${action.path}`);
        if (action.before) await currentOwned(plan.root, action.before);
      }
    }
    const mutations = plan.actions.filter(action => action.kind !== 'unchanged');
    if (mutations.length) {
      const journal = { version: 2, mode: plan.reviewedRecordSha256 ? 'adopt-reviewed' : 'sync',
        reviewedRecordSha256: plan.reviewedRecordSha256 ?? null,
        targets: plan.targets, manifestBefore: plan.manifestBytes, manifestAfter: plan.manifestText, actions: [] };
      for (const action of mutations) journal.actions.push({ kind: action.kind, path: action.path, target: action.target,
        before: action.before ?? null, after: action.kind === 'prune' ? null : action.after,
        beforeFile: action.before ? await currentOwned(plan.root, action.before) : action.kind === 'adopt' ? action.beforeFile : null,
        afterFile: action.kind === 'prune' ? null : action.file });
      if (beforeWrite) await beforeWrite(journalPath);
      await atomicWrite(path.join(plan.root, journalPath), `${JSON.stringify(journal, null, 2)}\n`);
      changedPaths.push(journalPath);
    }
    for (const action of mutations) {
      if (beforeWrite) await beforeWrite(action.path, action);
      await checkAdoptionConfig();
      const absolute = await safeAbsolute(plan.root, action.path);
      if (action.kind === 'create' && await metadata(absolute)) throw new Error(`unowned output collision: ${action.path}`);
      if (action.kind === 'adopt' && await readFile(absolute, 'utf8') !== action.beforeFile) throw new Error(`baseline hash changed: ${action.path}`);
      if (action.before) await currentOwned(plan.root, action.before);
      if (action.kind === 'prune') await unlink(absolute);
      else { await mkdir(path.dirname(absolute), { recursive: true }); await atomicWrite(absolute, action.file); }
      changedPaths.push(action.path);
    }
    const absolute = path.join(plan.root, manifestPath);
    const current = plan.manifestExisted ? await readFile(absolute, 'utf8') : null;
    if (current !== plan.manifestText) {
      if (beforeWrite) await beforeWrite(manifestPath);
      await checkAdoptionConfig();
      const latestMeta = await metadata(absolute);
      const latest = latestMeta ? await readFile(absolute, 'utf8') : null;
      if (latest !== plan.manifestBytes) throw new Error('manifest changed before final write');
      await atomicWrite(absolute, plan.manifestText);
      changedPaths.push(manifestPath);
    }
    if (mutations.length) { await unlink(path.join(plan.root, journalPath)); changedPaths.shift(); }
    await releaseLock();
    releaseLock = null;
    return { changedPaths, partialFailure: false };
  } catch (error) {
    if (releaseLock) try { await releaseLock(); } catch (releaseError) { return { changedPaths, partialFailure: true, error: `${error.message}; ${releaseError.message}` }; }
    return { changedPaths, partialFailure: true, error: error.message };
  }
}

function assertStoredFile(file, entry) {
  if (typeof file !== 'string' || sha(file) !== entry.fileSha256) throw new Error(`journal fileSha256 mismatch: ${entry.path}`);
  parseGeneratedFile(entry.target, file, entry);
}
function parseJournal(raw) {
  let journal;
  try { journal = JSON.parse(raw); } catch { throw new Error('invalid recovery journal JSON'); }
  const legacy = journal?.version === 1;
  const expectedFields = legacy ? 'version,targets,manifestBefore,manifestAfter,actions'
    : 'version,mode,reviewedRecordSha256,targets,manifestBefore,manifestAfter,actions';
  if (!journal || Object.keys(journal).join() !== expectedFields || ![1, 2].includes(journal.version)
      || (!legacy && (!['sync', 'adopt-reviewed'].includes(journal.mode)
        || (journal.mode === 'sync' ? journal.reviewedRecordSha256 !== null : !/^[a-f0-9]{64}$/.test(journal.reviewedRecordSha256))))
      || !Array.isArray(journal.targets) || !journal.targets.length || new Set(journal.targets).size !== journal.targets.length
      || journal.targets.some(target => !Object.hasOwn(roots, target)) || !Array.isArray(journal.actions) || !journal.actions.length) throw new Error('invalid recovery journal schema');
  const before = journal.manifestBefore === null ? { entries: [] } : JSON.parse(journal.manifestBefore);
  const after = JSON.parse(journal.manifestAfter);
  const beforeEntries = validateManifest(before), afterEntries = validateManifest(after);
  if (journal.manifestAfter !== `${JSON.stringify(after, null, 2)}\n`) throw new Error('noncanonical recovery manifest');
  const old = new Map(beforeEntries.map(entry => [entry.path, entry]));
  const next = new Map(beforeEntries.map(entry => [entry.path, entry]));
  const seen = new Set();
  for (const action of journal.actions) {
    if (!action || Object.keys(action).join() !== 'kind,path,target,before,after,beforeFile,afterFile'
        || !['create', 'update', 'prune', 'adopt'].includes(action.kind) || !journal.targets.includes(action.target)
        || seen.has(action.path)) throw new Error('invalid recovery action schema');
    seen.add(action.path);
    checkPath(action.path, action.target);
    if (action.before) {
      validateEntry(action.before);
      if (JSON.stringify(old.get(action.path)) !== JSON.stringify(action.before)) throw new Error(`journal previous ownership mismatch: ${action.path}`);
      assertStoredFile(action.beforeFile, action.before);
    } else if ((action.kind === 'adopt' ? typeof action.beforeFile !== 'string' : action.beforeFile !== null) || old.has(action.path)) throw new Error(`journal unowned collision: ${action.path}`);
    if (action.after) { validateEntry(action.after); assertStoredFile(action.afterFile, action.after); }
    else if (action.afterFile !== null) throw new Error('invalid recovery afterFile');
    if ((action.kind === 'create' && (action.before || !action.after))
        || (action.kind === 'update' && (!action.before || !action.after))
        || (action.kind === 'prune' && (!action.before || action.after))
        || (action.kind === 'adopt' && (action.before || !action.after || action.target !== 'codex'))) throw new Error('invalid recovery transition');
    if ((action.before ?? action.after).path !== action.path || (action.before ?? action.after).target !== action.target
        || (action.after && (action.after.path !== action.path || action.after.target !== action.target))) throw new Error('recovery path mismatch');
    if (action.after) next.set(action.path, action.after); else next.delete(action.path);
  }
  if (!legacy && ((journal.mode === 'sync' && journal.actions.some(action => action.kind === 'adopt'))
      || (journal.mode === 'adopt-reviewed' && (journal.targets.length !== 1 || journal.targets[0] !== 'codex'
        || !journal.actions.some(action => action.kind === 'adopt'))))) throw new Error('recovery journal mode/action mismatch');
  if (JSON.stringify([...next.values()].sort(compare)) !== JSON.stringify(afterEntries)) throw new Error('recovery manifest transition mismatch');
  return journal;
}
export async function recoverPartial({ root, targets, record, rendered }, { beforeWrite } = {}) {
  if (!path.isAbsolute(root) || !Array.isArray(targets) || !targets.length) throw new Error('invalid recovery inputs');
  const changedPaths = [];
  let manualRegistrationReview;
  let releaseLock;
  try {
    releaseLock = await acquireRootLock(root);
    await safeAbsolute(root, journalPath);
    const raw = await readFile(path.join(root, journalPath), 'utf8');
    const journal = parseJournal(raw);
    if (journal.version === 1 && journal.targets.includes('codex')) throw new Error('legacy Codex adopt/review journal has ambiguous origin; manual reconciliation required');
    const hasAdoption = journal.mode === 'adopt-reviewed';
    if (hasAdoption && !record) throw new Error('adopt recovery requires explicit reviewed input; manual reconciliation is required');
    if (record) {
      if (!hasAdoption) throw new Error('reviewed recovery requires an adopt journal');
      if (sha(JSON.stringify(record)) !== journal.reviewedRecordSha256) throw new Error('reviewed recovery record digest mismatch');
      const review = await reviewedIntent(root, record, rendered);
      const { reviewed } = review;
      manualRegistrationReview = review.manualRegistrationReview;
      if (journal.actions.length !== reviewed.size) throw new Error('reviewed recovery journal path count mismatch');
      for (const action of journal.actions) {
        const intent = reviewed.get(action.path);
        if (!intent || action.kind !== (intent.state === 'existing' ? 'adopt' : 'create')
            || action.afterFile !== intent.generated.file
            || JSON.stringify(action.after) !== JSON.stringify(intent.generated.entry)
            || (intent.state === 'existing' ? sha(action.beforeFile) !== intent.file.oldSha256 : action.beforeFile !== null))
          throw new Error(`reviewed recovery journal/record mismatch: ${action.path}`);
      }
    }
    if (JSON.stringify(targets) !== JSON.stringify(journal.targets)) throw new Error('recovery target selection mismatch');
    await safeAbsolute(root, manifestPath);
    const manifestMeta = await metadata(path.join(root, manifestPath));
    const currentManifest = manifestMeta ? await readFile(path.join(root, manifestPath), 'utf8') : null;
    if (currentManifest !== journal.manifestBefore && currentManifest !== journal.manifestAfter) throw new Error('recovery manifest drift');
    // Verify the full action set before the first recovery write.
    for (const action of journal.actions) {
      const absolute = await safeAbsolute(root, action.path);
      const meta = await metadata(absolute);
      if (meta && !meta.isFile()) throw new Error(`recovery output not a file: ${action.path}`);
      const current = meta ? await readFile(absolute, 'utf8') : null;
      if (current !== action.beforeFile && current !== action.afterFile) throw new Error(`recovery output drift: ${action.path}`);
    }
    for (const action of journal.actions) {
      const absolute = await safeAbsolute(root, action.path);
      const meta = await metadata(absolute);
      const current = meta ? await readFile(absolute, 'utf8') : null;
      if (current === action.afterFile) continue;
      if (current !== action.beforeFile) throw new Error(`recovery output drift: ${action.path}`);
      if (beforeWrite) await beforeWrite(action.path, action);
      if (record && sha(await readFile(await safeAbsolute(root, '.codex/config.toml'))) !== record.configSha256) throw new Error('config baseline hash changed during recovery');
      const latestMeta = await metadata(absolute);
      const latestOutput = latestMeta ? await readFile(absolute, 'utf8') : null;
      if (latestOutput !== action.beforeFile) throw new Error(`recovery output changed before write: ${action.path}`);
      if (action.kind === 'prune') await unlink(absolute);
      else { await mkdir(path.dirname(absolute), { recursive: true }); await atomicWrite(absolute, action.afterFile); }
      changedPaths.push(action.path);
    }
    if (currentManifest !== journal.manifestAfter) {
      if (beforeWrite) await beforeWrite(manifestPath);
      if (record && sha(await readFile(await safeAbsolute(root, '.codex/config.toml'))) !== record.configSha256) throw new Error('config baseline hash changed during recovery');
      const latestMeta = await metadata(path.join(root, manifestPath));
      const latest = latestMeta ? await readFile(path.join(root, manifestPath), 'utf8') : null;
      if (latest !== currentManifest) throw new Error('recovery manifest changed before final write');
      await atomicWrite(path.join(root, manifestPath), journal.manifestAfter);
      changedPaths.push(manifestPath);
    }
    if (await readFile(path.join(root, manifestPath), 'utf8') !== journal.manifestAfter) throw new Error('recovery manifest drift before cleanup');
    await unlink(path.join(root, journalPath));
    await releaseLock();
    releaseLock = null;
    return { changedPaths, partialFailure: false, ...(record ? { manualRegistrationReview } : {}) };
  } catch (error) {
    if (releaseLock) try { await releaseLock(); } catch (releaseError) { return { changedPaths, partialFailure: true, error: `${error.message}; ${releaseError.message}` }; }
    return { changedPaths, partialFailure: true, error: error.message };
  }
}
