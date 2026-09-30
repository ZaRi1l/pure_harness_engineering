import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertPortableText, assertSafeRelativePath, parseRole } from './schema.mjs';

export const CORE_ROLE_IDS = ['planner', 'worker', 'verifier', 'reviewer', 'goal-manager'];
export const CORE_SKILL_IDS = ['task-routing', 'task-spec', 'testing', 'failure-recovery'];

export async function listSkills(root, profile) {
  if (!['core', 'all'].includes(profile)) throw new Error(`invalid profile: ${profile}`);
  const directory = path.join(root, '.agents/skills');
  const entries = await readdir(directory, { withFileTypes: true });
  const ids = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  for (const id of ids) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`invalid skill id: ${id}`);
    const file = path.join(directory, id, 'SKILL.md');
    if (!(await stat(file)).isFile()) throw new Error(`missing skill file: ${id}`);
    async function inspect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await inspect(absolute);
        else if (entry.isFile()) {
          const relative = path.relative(root, absolute).split(path.sep).join('/');
          assertPortableText(await readFile(absolute, 'utf8'), relative);
        } else throw new Error(`portable skill contains unsupported file type: ${absolute}`);
      }
    }
    await inspect(path.join(directory, id));
  }
  for (const id of CORE_SKILL_IDS) if (!ids.includes(id)) throw new Error(`missing core skill: ${id}`);
  const selected = profile === 'core' ? CORE_SKILL_IDS : [
    ...CORE_SKILL_IDS, ...ids.filter(id => !CORE_SKILL_IDS.includes(id)).sort(),
  ];
  return selected.map(id => ({ id, path: `.agents/skills/${id}/SKILL.md` }));
}

export function skillAvailability(target, compatibility) {
  const record = compatibility?.targets?.[target];
  const version = record?.testedCliVersion ?? null;
  const evidence = record?.skillDiscoveryEvidence;
  if (target === 'codex' && version && evidence?.status === 'documented-native'
      && evidence.version === version && evidence.directory === '.agents/skills'
      && evidence.source === record.skillDocs
      && evidence.source === 'https://developers.openai.com/codex/skills/') {
    return { status: 'native', reason: 'Documented project skill directory for the pinned Codex CLI; native smoke remains a separate gate.', version };
  }
  return { status: 'unsupported', reason: version
    ? 'Canonical skill directory discovery is not verified for this installed target version; no version-gated generated copy rule exists.'
    : 'No tested target version or version-gated generated copy rule is available.', version };
}

export async function inventoryCodexRoles(root) {
  const config = await readFile(path.join(root, '.codex/config.toml'), 'utf8');
  const ids = [...config.matchAll(/^\[agents\.([a-z][a-z0-9-]*)\]$/gm)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate id in Codex config');
  for (const id of ids) await stat(path.join(root, `.codex/agents/${id}.toml`));
  return ids;
}

export async function loadRoles(root, profile) {
  if (!['core', 'all'].includes(profile)) throw new Error(`invalid profile: ${profile}`);
  const directory = path.join(root, 'harness/agents');
  const names = (await readdir(directory)).filter(name => name.endsWith('.md'));
  const seenPaths = new Set(), seenIds = new Set(), roles = [];
  for (const name of names) {
    const relative = assertSafeRelativePath(`harness/agents/${name}`, 'harness/agents', seenPaths);
    const role = parseRole(await readFile(path.join(root, relative), 'utf8'), relative);
    if (seenIds.has(role.id)) throw new Error(`duplicate id: ${role.id}`);
    seenIds.add(role.id);
    if (relative !== `harness/agents/${role.id}.md`) throw new Error(`id and sourcePath mismatch: ${role.id}`);
    for (const skill of role.body.matchAll(/\.agents\/skills\/([a-z][a-z0-9-]*)\/SKILL\.md/g)) {
      const referenced = path.join(root, `.agents/skills/${skill[1]}/SKILL.md`);
      try { await stat(referenced); } catch (error) { if (error.code === 'ENOENT') throw new Error(`missing referenced skill: ${skill[1]}`); throw error; }
    }
    roles.push(role);
  }
  for (const id of CORE_ROLE_IDS) if (!seenIds.has(id)) throw new Error(`missing core id: ${id}`);
  for (const role of roles) if (CORE_ROLE_IDS.includes(role.id) !== (role.tier === 'core')) throw new Error(`tier mismatch: ${role.id}`);
  const ordered = roles.sort((a, b) => {
    const ai = CORE_ROLE_IDS.indexOf(a.id), bi = CORE_ROLE_IDS.indexOf(b.id);
    return ai !== -1 && bi !== -1 ? ai - bi : ai !== -1 ? -1 : bi !== -1 ? 1 : a.id.localeCompare(b.id);
  });
  return profile === 'core' ? ordered.filter(role => role.tier === 'core') : ordered;
}
