// Deliberately smaller than YAML: scalar strings, flat maps, and string lists.
const scalar = (raw, label) => {
  const value = raw.trim();
  if (!value) throw new Error(`${label}: empty scalar`);
  if (/^(?:yes|no|true|false|on|off|null|~)$/i.test(value)) throw new Error(`${label}: implicit boolean/null is unsupported`);
  if (/[&*!|>\[{}`]/.test(value) || value.includes('<<:')) throw new Error(`${label}: alias, anchor, tag, merge, or complex YAML is unsupported`);
  if (/^['"]/.test(value)) {
    if (value.length < 2 || value.at(-1) !== value[0]) throw new Error(`${label}: malformed quoted scalar`);
    return value.slice(1, -1);
  }
  if (value.includes(': ')) throw new Error(`${label}: nested YAML is unsupported`);
  return value;
};

export function parseYamlSubset(frontmatter) {
  const result = {}, lines = frontmatter.replace(/\r\n/g, '\n').split('\n');
  let parent = null, kind = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/\t/.test(line) || /^\s*#/.test(line)) throw new Error('unsupported YAML indentation or comment');
    const top = /^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/.exec(line);
    if (top) {
      const [, key, raw = ''] = top;
      if (Object.hasOwn(result, key)) throw new Error(`duplicate key: ${key}`);
      parent = key;
      if (!raw) { result[key] = null; kind = null; }
      else if (raw === '[]') { result[key] = []; kind = 'scalar'; }
      else { result[key] = scalar(raw, key); kind = 'scalar'; }
      continue;
    }
    const map = /^  ([A-Za-z][A-Za-z0-9]*): (.+)$/.exec(line);
    if (map) {
      if (!parent || kind === 'list' || kind === 'scalar') throw new Error('unsupported YAML nesting');
      result[parent] ||= {};
      kind = 'map';
      if (Object.hasOwn(result[parent], map[1])) throw new Error(`duplicate key: ${map[1]}`);
      result[parent][map[1]] = scalar(map[2], map[1]);
      continue;
    }
    const item = /^  - (.+)$/.exec(line);
    if (item) {
      if (!parent || kind === 'map' || kind === 'scalar') throw new Error('unsupported YAML nesting');
      result[parent] ||= [];
      kind = 'list';
      result[parent].push(scalar(item[1], parent));
      continue;
    }
    throw new Error(`unsupported YAML syntax: ${line}`);
  }
  return result;
}
