const statuses = new Set(['native', 'advisory-only', 'unsupported', 'not-applicable']);

export function capability(sourceField, name, status, emittedConstruct, reason) {
  if (!statuses.has(status)) throw new Error(`invalid capability status: ${status}`);
  return { sourceField, capability: name, status, emittedConstruct, reason };
}

export function assertEnforcement(role, reports) {
  const seen = new Set();
  for (const report of reports) {
    if (seen.has(report.capability)) throw new Error(`duplicate capability report: ${report.capability}`);
    seen.add(report.capability);
  }
  for (const name of role.requiresEnforcement) {
    const report = reports.find(item => item.capability === name);
    if (!report || report.status !== 'native') throw new Error(`requiresEnforcement ${name} is not verified native`);
  }
}

export function validateContext(context, targetId) {
  if (!context?.compatibility?.targets?.[targetId]) throw new Error(`missing compatibility for ${targetId}`);
  if (!['core', 'all'].includes(context.profile)) throw new Error(`invalid profile: ${context.profile}`);
}

export function validateModel(model, targetId) {
  if (typeof model !== 'string' || !model || /[\r\n"'`]/.test(model)) throw new Error(`invalid ${targetId} model`);
  if (targetId === 'antigravity' && !['inherit', 'flash', 'pro'].includes(model)) throw new Error(`unsupported antigravity model: ${model}`);
  if (targetId === 'claude' && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(model)) throw new Error(`invalid claude model: ${model}`);
  if (targetId === 'opencode' && model !== 'inherit' && !/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(model)) throw new Error(`invalid opencode provider/model: ${model}`);
  return model;
}

export function yamlScalar(value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('invalid YAML scalar');
  return JSON.stringify(value);
}

export function tomlScalar(value) {
  if (typeof value !== 'string') throw new Error('invalid TOML scalar');
  return JSON.stringify(value);
}

export function codexMultiline(value) {
  if (typeof value !== 'string') throw new Error('invalid Codex body');
  return JSON.stringify(value);
}
