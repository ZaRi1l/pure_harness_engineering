import { assertEnforcement, capability, validateContext, validateModel, yamlScalar } from '../capabilities.mjs';

export const targetId = 'antigravity';
export const outputRoot = '.agents/agents';
export const declaredPaths = roles => roles.map(role => `${outputRoot}/${role.id}/agent.md`);

const documentedTools = new Set(['view_file', 'grep_search', 'replace_file_content', 'run_command']);

export function renderRole(role, context) {
  validateContext(context, targetId);
  const model = validateModel(role.modelPolicy[targetId], targetId);
  const tools = role.intent === 'read-only' ? ['view_file', 'grep_search', ...(role.needs.includes('shell') ? ['run_command'] : [])] : [
    'view_file', 'grep_search', ...(role.needs.includes('write') ? ['replace_file_content'] : []),
    ...(role.needs.includes('shell') ? ['run_command'] : []),
  ];
  if (tools.some(name => !documentedTools.has(name))) throw new Error('undocumented Antigravity tool');
  const lines = ['---', `name: ${role.id}`, `description: ${yamlScalar(role.description)}`,
    'subagent: true', 'mainAgent: false', `model: ${model}`, 'tools:',
    ...tools.map(name => `  - ${name}`), '---', role.body];
  const capabilities = role.needs.map(name => capability('needs', name,
    name === 'read' ? 'native' : 'unsupported',
    name === 'read' ? 'tools: view_file, grep_search' : name === 'shell' ? 'tools: run_command' : name === 'write' && role.intent !== 'read-only' ? 'tools: replace_file_content' : 'none',
    name === 'read' ? 'Documented read tool names; native smoke remains unverified.' : name === 'shell' ? 'Candidate lists run_command, but no installed Antigravity native load or tool execution has been verified; it may also write.' : 'Effective tool-name/version behavior has not been smoke-proven; this capability is not mapped.'));
  if (role.intent === 'read-only' && !role.needs.includes('write')) capabilities.push(capability('intent', 'write', 'unsupported',
    'tools allowlist', 'Tool validation and alternate write paths remain unverified.'));
  assertEnforcement(role, capabilities);
  return { path: declaredPaths([role])[0], body: `${lines.join('\n')}\n`, capabilities };
}
