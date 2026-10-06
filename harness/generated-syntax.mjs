// A bounded parser for the exact scalar/list/map subset emitted by the four adapters.
// It is intentionally not a general TOML or YAML parser.
export const RENDERER_VERSION = '1';

const targetFields = {
  codex: new Set(['name', 'description', 'model', 'model_reasoning_effort', 'sandbox_mode', 'developer_instructions']),
  claude: new Set(['name', 'description', 'model', 'tools', 'disallowedTools', 'permissionMode']),
  opencode: new Set(['description', 'mode', 'model', 'permission']),
  antigravity: new Set(['name', 'description', 'subagent', 'mainAgent', 'model', 'tools']),
};

function requireField(values, field, kind) {
  if (!Object.hasOwn(values, field)) throw new Error(`missing generated field: ${field}`);
  if (typeof values[field] !== kind) throw new Error(`${field} must be a ${kind}`);
}

function parseToml(body) {
  const values = {};
  for (const line of body.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([A-Za-z][A-Za-z0-9_]*) = (.+)$/.exec(line);
    if (!match) throw new Error(`invalid TOML assignment or section: ${line}`);
    const [, field, raw] = match;
    if (!targetFields.codex.has(field)) throw new Error(`unsupported generated field: ${field}`);
    if (Object.hasOwn(values, field)) throw new Error(`duplicate generated field: ${field}`);
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new Error(`invalid TOML string: ${field}`); }
    if (typeof value !== 'string') throw new Error(`${field} must be a string`);
    values[field] = value;
  }
  for (const field of ['name', 'description', 'developer_instructions']) requireField(values, field, 'string');
  if (values.model_reasoning_effort !== undefined && !['low', 'medium', 'high', 'xhigh'].includes(values.model_reasoning_effort)) throw new Error('invalid model_reasoning_effort');
  if (values.sandbox_mode !== undefined && values.sandbox_mode !== 'read-only') throw new Error('invalid sandbox_mode');
  return values;
}

function yamlScalar(raw, field) {
  if (!raw || /[\t\r]/.test(raw)) throw new Error(`invalid YAML scalar: ${field}`);
  if (raw.startsWith('"')) {
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new Error(`invalid YAML string: ${field}`); }
    if (typeof value !== 'string') throw new Error(`${field} must be a string`);
    return value;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/[:#\[\]{}|>`]/.test(raw) || /^[&*!']/.test(raw)) throw new Error(`invalid YAML scalar: ${field}`);
  return raw;
}

function parseYaml(body, target) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(body);
  if (!match) throw new Error('missing or malformed generated YAML frontmatter');
  const values = {};
  let parent = null;
  for (const line of match[1].split(/\r?\n/)) {
    const top = /^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/.exec(line);
    if (top) {
      const [, field, raw] = top;
      if (!targetFields[target].has(field)) throw new Error(`unsupported generated field: ${field}`);
      if (Object.hasOwn(values, field)) throw new Error(`duplicate generated field: ${field}`);
      values[field] = raw === undefined ? null : yamlScalar(raw, field);
      parent = field;
      continue;
    }
    const list = /^  - (.+)$/.exec(line);
    if (list) {
      if (!parent || values[parent] !== null && !Array.isArray(values[parent])) throw new Error(`${parent ?? 'unknown'} must be a YAML list: ${line}`);
      values[parent] ??= [];
      values[parent].push(yamlScalar(list[1], parent));
      continue;
    }
    const map = /^  ([A-Za-z][A-Za-z0-9]*): (.+)$/.exec(line);
    if (map) {
      if (!parent || values[parent] !== null && (typeof values[parent] !== 'object' || Array.isArray(values[parent]))) throw new Error(`invalid YAML map nesting: ${line}`);
      values[parent] ??= {};
      if (Object.hasOwn(values[parent], map[1])) throw new Error(`duplicate generated field: ${parent}.${map[1]}`);
      values[parent][map[1]] = yamlScalar(map[2], `${parent}.${map[1]}`);
      continue;
    }
    throw new Error(`invalid YAML indentation or syntax: ${line}`);
  }
  if (!match[2].trim()) throw new Error('missing generated role body');
  return values;
}

export function validateGeneratedSyntax(target, body) {
  if (target === 'codex') return parseToml(body);
  if (!targetFields[target]) throw new Error(`unknown target: ${target}`);
  const values = parseYaml(body, target);
  if (target === 'claude') {
    for (const field of ['name', 'description', 'model']) requireField(values, field, 'string');
    for (const field of ['tools', 'disallowedTools', 'permissionMode']) if (values[field] !== undefined && typeof values[field] !== 'string') throw new Error(`${field} must be a string`);
  } else if (target === 'opencode') {
    for (const field of ['description', 'mode']) requireField(values, field, 'string');
    if (values.mode !== 'subagent') throw new Error('mode must be subagent');
    if (values.model !== undefined && typeof values.model !== 'string') throw new Error('model must be a string');
    if (values.permission !== undefined) {
      if (!values.permission || Array.isArray(values.permission) || typeof values.permission !== 'object') throw new Error('permission must be a map');
      for (const [field, value] of Object.entries(values.permission)) {
        if (!['edit', 'bash'].includes(field) || value !== 'deny') throw new Error(`invalid permission.${field}`);
      }
    }
  } else {
    for (const field of ['name', 'description', 'model']) requireField(values, field, 'string');
    for (const field of ['subagent', 'mainAgent']) requireField(values, field, 'boolean');
    if (values.subagent !== true || values.mainAgent !== false) throw new Error('invalid subagent/mainAgent flags');
    if (!Array.isArray(values.tools) || !values.tools.length || values.tools.some(value => typeof value !== 'string')) throw new Error('tools must be a nonempty list of strings');
  }
  return values;
}
