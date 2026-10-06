import { assertEnforcement, capability, codexMultiline, tomlScalar, validateContext, validateModel } from '../capabilities.mjs';

export const targetId = 'codex';
export const outputRoot = '.codex/agents';
export const declaredPaths = roles => roles.map(role => `${outputRoot}/${role.id}.toml`);

export function renderRole(role, context) {
  validateContext(context, targetId);
  const model = validateModel(role.modelPolicy[targetId], targetId);
  const lines = [`name = ${tomlScalar(role.id)}`, `description = ${tomlScalar(role.description)}`];
  if (model !== 'inherit') lines.push(`model = ${tomlScalar(model)}`);
  if (role.codexReasoningEffort) lines.push(`model_reasoning_effort = ${tomlScalar(role.codexReasoningEffort)}`);
  if (role.intent === 'read-only') lines.push('sandbox_mode = "read-only"');
  lines.push(`developer_instructions = ${codexMultiline(role.body)}`);
  const capabilities = role.needs.map(name => capability('needs', name,
    name === 'read' ? 'native' : name === 'web' ? 'unsupported' : 'advisory-only',
    name === 'read' ? 'Codex read tools' : name === 'web' ? 'none' : 'developer_instructions',
    name === 'read' ? 'Codex reads repository context.' : name === 'web' ? 'No web tool is declared by this adapter.' : 'A role prompt is not an execution boundary.'));
  if (role.intent === 'read-only' && !role.needs.includes('write')) capabilities.push(capability('intent', 'write', 'advisory-only', 'sandbox_mode = "read-only"',
    'Per-agent sandbox inheritance and effective write denial have not been smoke-proven.'));
  assertEnforcement(role, capabilities);
  return { path: declaredPaths([role])[0], body: `${lines.join('\n')}\n`, capabilities };
}
