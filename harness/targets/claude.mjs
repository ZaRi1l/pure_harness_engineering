import { assertEnforcement, capability, validateContext, validateModel, yamlScalar } from '../capabilities.mjs';

export const targetId = 'claude';
export const outputRoot = '.claude/agents';
export const declaredPaths = roles => roles.map(role => `${outputRoot}/${role.id}.md`);

export function renderRole(role, context) {
  validateContext(context, targetId);
  const model = validateModel(role.modelPolicy[targetId], targetId);
  const lines = ['---', `name: ${role.id}`, `description: ${yamlScalar(role.description)}`, `model: ${yamlScalar(model)}`];
  if (role.intent === 'read-only') {
    const shellNeeded = role.needs.includes('shell');
    lines.push(`tools: Read, Grep, Glob${shellNeeded ? ', Bash' : ''}`,
      `disallowedTools: Write, Edit${shellNeeded ? '' : ', Bash'}, mcp__*`);
  }
  lines.push('---', role.body);
  const capabilities = role.needs.map(name => {
    const omitted = name === 'web' || (role.intent === 'read-only' && ['write', 'delegate'].includes(name));
    return capability('needs', name,
      name === 'read' ? 'native' : omitted ? 'unsupported' : 'advisory-only',
      name === 'read' ? 'tools: Read, Grep, Glob' : omitted ? 'none' : name === 'shell' && role.intent === 'read-only' ? 'tools: Bash' : 'inherited tool pool',
      name === 'read' ? 'Documented built-in read tool allowlist.' : omitted ? 'Not present in the emitted read-only allowlist or adapter declaration.' : 'Effective permission depends on session and tool pool; Bash can also write.');
  });
  if (role.intent === 'read-only' && !role.needs.includes('write')) capabilities.push(capability('intent', 'write', 'advisory-only',
    'tools + disallowedTools', 'Parent/session/tool/MCP escape paths remain unverified.'));
  assertEnforcement(role, capabilities);
  return { path: declaredPaths([role])[0], body: `${lines.join('\n')}\n`, capabilities };
}
