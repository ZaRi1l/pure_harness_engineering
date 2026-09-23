import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const field = (text, name) => text.match(new RegExp('(?:^|\\n)' + name + '\\s*=\\s*"([^"]+)"'))?.[1] || '';
const frontmatter = text => text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
const yaml = (text, name) => text.match(new RegExp('(?:^|\\n)' + name + ':\\s*([^\\n]+)'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';

export function discoverCatalog(root) {
  const configPath = path.join(root, '.codex', 'config.toml');
  const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const agents = [...config.matchAll(/^\[agents\.([^\]]+)\]([\s\S]*?)(?=^\[|(?![\s\S]))/gm)].map(match => {
    const id = match[1], configFile = field(match[2], 'config_file');
    const file = configFile ? path.join(root, '.codex', configFile.replace(/^\.\//, '')) : '';
    const text = file && existsSync(file) ? readFileSync(file, 'utf8') : '';
    return { id, description: field(match[2], 'description'), path: configFile || '', name: field(text, 'name') || id, model: field(text, 'model'), reasoning: field(text, 'model_reasoning_effort'), source: text };
  });
  const skillRoot = path.join(root, '.agents', 'skills');
  const skills = existsSync(skillRoot) ? readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const file = path.join(skillRoot, entry.name, 'SKILL.md'), text = existsSync(file) ? readFileSync(file, 'utf8') : '', meta = frontmatter(text);
    return { id: entry.name, name: yaml(meta, 'name'), description: yaml(meta, 'description'), path: '.agents/skills/' + entry.name + '/SKILL.md', source: text, valid: Boolean(meta && yaml(meta, 'name') && yaml(meta, 'description')) };
  }).sort((a, b) => a.id.localeCompare(b.id)) : [];
  return { agents, skills };
}
