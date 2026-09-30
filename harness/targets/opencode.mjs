import { assertEnforcement, capability, validateContext, validateModel, yamlScalar } from '../capabilities.mjs';

export const targetId = 'opencode';
export const outputRoot = '.opencode/agents';
export const declaredPaths = roles => roles.map(role => `${outputRoot}/${role.id}.md`);

export function renderRole(role, context) {
  validateContext(context, targetId);
  const model = validateModel(role.modelPolicy[targetId], targetId);
  const lines = ['---', `description: ${yamlScalar(role.description)}`, 'mode: subagent'];
  if (model !== 'inherit') lines.push(`model: ${model}`);
  if (role.intent === 'read-only') {
    lines.push('permission:', '  edit: deny');
    if (!role.needs.includes('shell')) lines.push('  bash: deny');
  }
  lines.push('---', role.body);
  const capabilities = role.needs.map(name => {
    const omitted = name === 'web' || name === 'delegate';
    return capability('needs', name,
      name === 'read' ? 'native' : omitted || name === 'shell' ? 'unsupported' : 'advisory-only',
      name === 'read' ? 'OpenCode agent' : omitted ? 'none' : name === 'shell' ? role.intent === 'read-only' ? 'permission.bash not denied' : 'default bash permission' : 'default permissions',
      name === 'read' ? 'Documented agent can read context.' : omitted ? 'No web or delegation construct is emitted.' : name === 'shell' ? 'Candidate syntax permits Bash, but no installed OpenCode native load or tool execution has been verified.' : 'Installed CLI and effective permission behavior are unverified; Bash may write.');
  });
  if (role.intent === 'read-only' && !role.needs.includes('write')) capabilities.push(capability('intent', 'write', 'advisory-only',
    role.needs.includes('shell') ? 'permission.edit deny; bash permitted' : 'permission.edit + permission.bash deny',
    'Custom tools and installed CLI behavior are unverified; Bash can write when permitted.'));
  assertEnforcement(role, capabilities);
  return { path: declaredPaths([role])[0], body: `${lines.join('\n')}\n`, capabilities };
}
