import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isValidatedProjectContext } from './project-context.mjs';
import { isCoreContext } from './runtime-state.mjs';

function roots(context) {
  if (isValidatedProjectContext(context)) return { catalogRoot: context.harnessRoot, taskRoot: context.paths.tasks, taskPrefix: `projects/${context.projectId}/tasks` };
  if (isCoreContext(context)) return { catalogRoot: context.checkoutRoot, taskRoot: path.join(context.checkoutRoot, '.ai', 'tasks'), taskPrefix: '.ai/tasks' };
  if (context?.kind === 'legacy-fixture' && typeof context.root === 'string') return { catalogRoot: context.root, taskRoot: path.join(context.root, '.ai', 'tasks'), taskPrefix: '.ai/tasks' };
  throw new Error('validated project context required');
}
export const legacyCatalogFixture = root => Object.freeze({ kind: 'legacy-fixture', root });

const field = (text, name) => text.match(new RegExp('(?:^|\\n)' + name + '\\s*=\\s*"([^"]+)"'))?.[1] || '';
const frontmatter = text => text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
const yaml = (text, name) => text.match(new RegExp('(?:^|\\n)' + name + ':\\s*([^\\n]+)'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';

function roleSource(root, configFile) {
  const relative = configFile.replace(/^\.\//, '');
  if (!relative.startsWith('agents/') || relative.includes('\\') || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) return '';
  try {
    const owner = realpathSync(root), roleRoot = path.join(owner, '.codex', 'agents');
    if (path.relative(roleRoot, realpathSync(roleRoot)) !== '') return '';
    const file = realpathSync(path.join(owner, '.codex', relative));
    const withinRoleRoot = path.relative(roleRoot, file);
    if (!withinRoleRoot || withinRoleRoot === '..' || withinRoleRoot.startsWith(`..${path.sep}`) || path.isAbsolute(withinRoleRoot) || !statSync(file).isFile()) return '';
    return readFileSync(file, 'utf8');
  } catch { return ''; }
}

export function discoverCatalog(context) {
  const { catalogRoot: root } = roots(context);
  const configPath = path.join(root, '.codex', 'config.toml');
  const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const agents = [...config.matchAll(/^\[agents\.([^\]]+)\]([\s\S]*?)(?=^\[|(?![\s\S]))/gm)].map(match => {
    const id = match[1], configFile = field(match[2], 'config_file');
    const text = configFile ? roleSource(root, configFile) : '';
    return { id, description: field(match[2], 'description'), path: configFile || '', name: field(text, 'name') || id, model: field(text, 'model'), reasoning: field(text, 'model_reasoning_effort'), source: text };
  });
  const skillRoot = path.join(root, '.agents', 'skills');
  const skills = existsSync(skillRoot) ? readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const file = path.join(skillRoot, entry.name, 'SKILL.md'), text = existsSync(file) ? readFileSync(file, 'utf8') : '', meta = frontmatter(text);
    return { id: entry.name, name: yaml(meta, 'name'), description: yaml(meta, 'description'), path: '.agents/skills/' + entry.name + '/SKILL.md', source: text, valid: Boolean(meta && yaml(meta, 'name') && yaml(meta, 'description')) };
  }).sort((a, b) => a.id.localeCompare(b.id)) : [];
  return { agents, skills };
}

export function discoverTaskSpecs(context) {
  const { taskRoot, taskPrefix } = roots(context);
  if (!existsSync(taskRoot)) return [];
  return readdirSync(taskRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => {
      const file = path.join(taskRoot, entry.name), content = readFileSync(file, 'utf8');
      return {
        name: path.basename(entry.name, '.md'),
        path: taskPrefix + '/' + entry.name,
        title: content.match(/^#\s+(.+)$/m)?.[1] || path.basename(entry.name, '.md'),
        modifiedAt: statSync(file).mtime.toISOString(),
        content
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
