#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listSkills, loadRoles, skillAvailability } from '../harness/inventory.mjs';
import { assertPortableText } from '../harness/schema.mjs';
import { adoptReviewed, applyPlan, planSync, recoverPartial } from '../harness/ownership.mjs';
import * as codex from '../harness/targets/codex.mjs';
import * as claude from '../harness/targets/claude.mjs';
import * as opencode from '../harness/targets/opencode.mjs';
import * as antigravity from '../harness/targets/antigravity.mjs';

const adapters = [codex, claude, opencode, antigravity];
const byId = new Map(adapters.map(adapter => [adapter.targetId, adapter]));

function parseArgs(args) {
  const options = { root: process.cwd(), profile: 'all', dryRun: false, check: false, recover: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (['--dry-run', '--check', '--json', '--recover'].includes(flag)) {
      if (seen.has(flag)) throw new Error(`duplicate ${flag}`);
      seen.add(flag);
      options[flag === '--dry-run' ? 'dryRun' : flag.slice(2)] = true;
      continue;
    }
    if (!['--root', '--targets', '--profile', '--adopt-reviewed'].includes(flag)) throw new Error(`unknown option: ${flag}`);
    if (seen.has(flag)) throw new Error(`duplicate ${flag}`);
    seen.add(flag);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag === '--adopt-reviewed' ? 'adoptReviewed' : flag.slice(2)] = value;
  }
  if (!options.targets) throw new Error('--targets is required');
  if (options.check && options.dryRun) throw new Error('--check and --dry-run are exclusive');
  if (options.recover && (options.check || options.dryRun)) throw new Error('--recover cannot be combined with --check or --dry-run');
  if (!['core', 'all'].includes(options.profile)) throw new Error('invalid --profile');
  const names = options.targets === 'all' ? adapters.map(adapter => adapter.targetId) : options.targets.split(',');
  if (!names.length || new Set(names).size !== names.length || names.some(name => !byId.has(name))) throw new Error('invalid --targets');
  options.targets = names;
  if (options.adoptReviewed && (options.check || options.dryRun || options.recover || options.json
      || names.length !== 1 || names[0] !== 'codex' || options.profile !== 'all'))
    throw new Error('--adopt-reviewed requires --targets codex --profile all and cannot combine with other modes');
  options.root = path.resolve(options.root);
  return options;
}

async function assertNativeReady(root, targets, profile, compatibility) {
  const skills = await listSkills(root, profile);
  for (const target of targets) {
    const smoke = compatibility?.targets?.[target]?.nativeSmoke ?? 'unverified';
    if (smoke !== 'passed') throw new Error(`${target}: native smoke ${smoke}; refusing sync write`);
    if (skills.length && skillAvailability(target, compatibility).status !== 'native')
      throw new Error(`${target}: skill discovery unverified; refusing sync write`);
  }
}

async function sync(options) {
  const { root, targets, profile } = options;
  const compatibilityText = await readFile(path.join(root, 'harness/compatibility.json'), 'utf8');
  assertPortableText(compatibilityText, 'harness/compatibility.json');
  const compatibility = JSON.parse(compatibilityText);
  if (options.recover) {
    await assertNativeReady(root, targets, profile, compatibility);
    const result = await recoverPartial({ root, targets });
    return { ok: !result.partialFailure, ...result };
  }
  const roles = await loadRoles(root, profile);
  const rendered = [];
  for (const target of targets) for (const role of roles) {
    const result = byId.get(target).renderRole(role, { compatibility, profile });
    assertPortableText(result.body, result.path);
    rendered.push({ ...result, target, roleId: role.id, sourcePath: role.sourcePath, sourceSha256: role.sourceSha256 });
  }
  if (options.adoptReviewed) {
    await assertNativeReady(root, targets, profile, compatibility);
    const record = JSON.parse(await readFile(path.resolve(root, options.adoptReviewed), 'utf8'));
    return { ok: true, ...await adoptReviewed({ root, record, rendered }) };
  }
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; manifest = { entries: [] }; }
  const plan = await planSync({ root, targets, profile, rendered, manifest });
  const summary = { ok: plan.writable, actions: plan.actions.map(({ path, target, roleId, kind, reason }) => ({ path, target, roleId, kind, ...(reason ? { reason } : {}) })), manifestDirty: plan.manifestDirty };
  if (options.check) return { ...summary, ok: summary.ok && !plan.manifestDirty && plan.actions.every(action => action.kind === 'unchanged') };
  if (options.dryRun || !plan.writable) return summary;
  await assertNativeReady(root, targets, profile, compatibility);
  const applied = await applyPlan(plan);
  return { ...summary, ok: !applied.partialFailure, ...applied };
}

async function main(args) {
  try {
    const options = parseArgs(args);
    const result = await sync(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2));
