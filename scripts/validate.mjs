#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertEnforcement } from '../harness/capabilities.mjs';
import { listSkills, loadRoles, skillAvailability } from '../harness/inventory.mjs';
import { assertPortableText, assertSafeRelativePath } from '../harness/schema.mjs';
import { RENDERER_VERSION, validateGeneratedSyntax } from '../harness/generated-syntax.mjs';
import { parseGeneratedFile, validateManifest as validateOwnedManifest } from '../harness/ownership.mjs';
import * as codex from '../harness/targets/codex.mjs';
import * as claude from '../harness/targets/claude.mjs';
import * as opencode from '../harness/targets/opencode.mjs';
import * as antigravity from '../harness/targets/antigravity.mjs';

const adapters = [codex, claude, opencode, antigravity];
const adapterById = new Map(adapters.map(adapter => [adapter.targetId, adapter]));
const compare = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
const issue = (target, roleId, sourceField, reason) => ({ target, roleId, sourceField, reason });

function selectedTargets(targets) {
  if (targets === undefined || targets === null || targets === '') throw new Error('--targets is required');
  const names = typeof targets === 'string' ? targets.split(',') : targets;
  if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !name)) throw new Error('invalid --targets');
  if (names.length === 1 && names[0] === 'all') return adapters.map(adapter => adapter.targetId);
  if (names.includes('all')) throw new Error('--targets all cannot be combined with another target');
  if (new Set(names).size !== names.length) throw new Error('duplicate --targets');
  for (const name of names) if (!adapterById.has(name)) throw new Error(`unknown --targets value: ${name}`);
  return names;
}

async function assertNoSymlink(root, relative) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`symlink in generated path: ${relative}`);
  }
}

async function validateManifest(root, selected, roles, renderedByKey, issues) {
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(root, 'harness/generated-manifest.json'), 'utf8')); }
  catch (error) {
    issues.push(issue('all', null, 'manifest', error.code === 'ENOENT' ? 'missing generated manifest' : `invalid generated manifest: ${error.message}`));
    return;
  }
  if (!Array.isArray(manifest?.entries)) {
    issues.push(issue('all', null, 'manifest', 'generated manifest entries must be an array'));
    return;
  }
  try { validateOwnedManifest(manifest); }
  catch (error) { issues.push(issue('all', null, 'manifest', error.message)); }
  const roleById = new Map(roles.map(role => [role.id, role]));
  const seen = new Set();
  const declared = new Set();
  for (const entry of manifest.entries) {
    if (!adapterById.has(entry?.target)) {
      issues.push(issue(entry?.target ?? 'all', entry?.roleId ?? null, 'manifest', `unknown target in generated manifest: ${entry?.target}`));
      continue;
    }
    if (!selected.includes(entry.target)) continue;
    const adapter = adapterById.get(entry.target);
    const entryIssue = reason => issues.push(issue(entry.target, entry.roleId ?? null, 'generated', `${entry.path ?? '(missing path)'}: ${reason}`));
    try {
      assertSafeRelativePath(entry.path, adapter.outputRoot, seen);
      const role = roleById.get(entry.roleId);
      if (!role) throw new Error(`unknown role ID: ${entry.roleId}`);
      if (entry.path !== adapter.declaredPaths([{ id: entry.roleId }])[0]) throw new Error('undeclared output path');
      declared.add(`${entry.target}:${entry.roleId}`);
      if (entry.sourcePath !== role.sourcePath) entryIssue('sourcePath drift');
      if (entry.sourceSha256 !== role.sourceSha256) entryIssue('sourceSha256 drift');
      if (entry.rendererVersion !== RENDERER_VERSION) entryIssue(`rendererVersion mismatch: expected ${RENDERER_VERSION}`);
      const expected = renderedByKey.get(`${entry.target}:${entry.roleId}`);
      if (!expected) throw new Error('no current adapter render for this role');
      const expectedBodyHash = createHash('sha256').update(expected.body).digest('hex');
      if (entry.bodySha256 !== expectedBodyHash) entryIssue('bodySha256 drift from current adapter render');
      await assertNoSymlink(root, entry.path);
      const bytes = await readFile(path.join(root, entry.path));
      if (!/^[a-f0-9]{64}$/.test(entry.fileSha256) || createHash('sha256').update(bytes).digest('hex') !== entry.fileSha256) entryIssue('fileSha256 drift');
      const body = parseGeneratedFile(entry.target, bytes.toString('utf8'), entry).body;
      if (createHash('sha256').update(body).digest('hex') !== entry.bodySha256) entryIssue('bodySha256 drift from generated file');
      try { validateGeneratedSyntax(entry.target, body); }
      catch (error) { entryIssue(error.message); }
      if (body !== expected.body) entryIssue('generated body differs from current adapter render');
    } catch (error) {
      entryIssue(error.message);
    }
  }
  for (const target of selected) for (const role of roles) {
    if (!declared.has(`${target}:${role.id}`)) issues.push(issue(target, role.id, 'manifest', `missing generated entry: ${adapterById.get(target).declaredPaths([role])[0]}`));
  }
}

export async function validateRepository({ root, targets, profile = 'all' }) {
  const selected = selectedTargets(targets);
  if (!['core', 'all'].includes(profile)) throw new Error(`invalid --profile: ${profile}`);
  const issues = [], capabilities = [];
  const inventory = { roles: [], skills: [], targets: {} };
  const renderedByKey = new Map();
  let compatibility, roles, skills;
  try {
    const compatibilityText = await readFile(path.join(root, 'harness/compatibility.json'), 'utf8');
    assertPortableText(compatibilityText, 'harness/compatibility.json');
    compatibility = JSON.parse(compatibilityText);
    roles = await loadRoles(root, profile);
    skills = await listSkills(root, profile);
    inventory.roles = roles.map(role => role.id);
    inventory.skills = skills.map(skill => skill.id);
  } catch (error) {
    issues.push(issue('all', null, 'source', error.message));
    return { ok: false, issues, capabilities, inventory };
  }
  for (const target of selected) {
    const adapter = adapterById.get(target);
    const evidence = compatibility?.targets?.[target];
    inventory.targets[target] = { testedCliVersion: evidence?.testedCliVersion || 'unverified', nativeSmoke: evidence?.nativeSmoke || 'unverified' };
    if (!evidence) issues.push(issue(target, null, 'compatibility', 'target compatibility evidence is missing'));
    if (inventory.targets[target].nativeSmoke !== 'passed') issues.push(issue(target, null, 'nativeSmoke', `native smoke ${inventory.targets[target].nativeSmoke}; target syntax and effective permissions are unverified`));
    const availability = skillAvailability(target, compatibility);
    if (skills.length && availability.status !== 'native') issues.push(issue(target, null, 'skills', `skill discovery unverified: ${availability.reason}`));
    for (const role of roles) {
      try {
        // Collect the actual adapter report even when a strict requirement rejects it.
        const rendered = adapter.renderRole({ ...role, requiresEnforcement: [] }, { compatibility, profile });
        assertPortableText(rendered.body, rendered.path);
        if (rendered.path !== adapter.declaredPaths([role])[0] || typeof rendered.body !== 'string' || !rendered.body) {
          throw new Error('rendered path or body does not match declared output');
        }
        renderedByKey.set(`${target}:${role.id}`, rendered);
        for (const report of rendered.capabilities) capabilities.push({ target, roleId: role.id, ...report });
        try { assertEnforcement(role, rendered.capabilities); }
        catch (error) { issues.push(issue(target, role.id, 'requiresEnforcement', error.message)); }
      } catch (error) {
        const sourceField = /model|provider/i.test(error.message) ? 'modelPolicy' : 'render';
        issues.push(issue(target, role.id, sourceField, error.message));
      }
    }
  }
  await validateManifest(root, selected, roles, renderedByKey, issues);
  issues.sort(compare);
  capabilities.sort(compare);
  return { ok: issues.length === 0, issues, capabilities, inventory };
}

function parseArgs(args) {
  const options = { root: process.cwd(), profile: 'all' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--json') { options.json = true; continue; }
    if (!['--root', '--targets', '--profile'].includes(flag)) throw new Error(`unknown option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    const key = flag.slice(2);
    if (options[key] !== undefined && key !== 'root' && key !== 'profile') throw new Error(`duplicate ${flag}`);
    options[key] = value;
  }
  return options;
}

async function main(args) {
  const json = args.includes('--json');
  try {
    const result = await validateRepository(parseArgs(args));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const result = { ok: false, issues: [issue('all', null, 'arguments', error.message)], capabilities: [], inventory: { roles: [], skills: [], targets: {} } };
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2));
