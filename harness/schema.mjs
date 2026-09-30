import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseYamlSubset } from './yaml-subset.mjs';

const fields = ['schemaVersion', 'id', 'description', 'tier', 'intent', 'modelPolicy', 'codexReasoningEffort', 'needs', 'requiresEnforcement'];
const targets = ['codex', 'claude', 'opencode', 'antigravity'];
const capabilities = new Set(['read', 'write', 'shell', 'delegate', 'web']);
const nonportable = [
  /\bsil[o](?:\b|[_-])/i,
  /prototype[\\/]preview/i,
  /runtime-state\.mjs|docker[\\/]\.env|\.ai[\\/]runtime|localhost/i,
  /\b[A-Za-z]:[\\/]|\/(?:Users|home|root)\//i,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk-[A-Za-z0-9]{20,}\b/i,
  /\b(?:api[_-]?key|password|client[_-]?secret|access[_-]?token)\s*[:=]\s*(?:["'][^"'\r\n]{8,}["']|[A-Za-z0-9_./+=-]{16,})/i,
];

export function assertPortableText(text, sourcePath) {
  if (typeof text !== 'string' || text.includes('\0') || nonportable.some(pattern => pattern.test(text)))
    throw new Error(`portable source contains project identity, host path, or credential material: ${sourcePath}`);
}

export function assertSafeRelativePath(value, allowedRoot, seen) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw new Error(`invalid path: ${value}`);
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error(`invalid path traversal: ${value}`);
  if (value !== allowedRoot && !value.startsWith(`${allowedRoot}/`)) throw new Error(`path outside allowed root: ${value}`);
  const folded = value.toLowerCase();
  if (seen?.has(folded)) throw new Error(`case collision: ${value}`);
  seen?.add(folded);
  return value;
}

export function parseRole(text, sourcePath) {
  assertSafeRelativePath(sourcePath, 'harness/agents');
  assertPortableText(text, sourcePath);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error('role requires YAML frontmatter and body');
  const raw = parseYamlSubset(match[1]);
  for (const key of Object.keys(raw)) if (!fields.includes(key)) throw new Error(`unknown field: ${key}`);
  for (const key of fields) if (!Object.hasOwn(raw, key)) throw new Error(`missing ${key}`);
  if (raw.schemaVersion !== '1') throw new Error('schemaVersion must be 1');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(raw.id)) throw new Error('invalid id');
  if (typeof raw.description !== 'string' || !raw.description.trim()) throw new Error('description required');
  if (!['core', 'optional'].includes(raw.tier)) throw new Error('invalid tier');
  if (!['read-only', 'writer', 'coordinator'].includes(raw.intent)) throw new Error('invalid intent');
  if (!raw.modelPolicy || Array.isArray(raw.modelPolicy) || typeof raw.modelPolicy !== 'object') throw new Error('modelPolicy map required');
  for (const target of targets) if (typeof raw.modelPolicy[target] !== 'string' || !raw.modelPolicy[target]) throw new Error(`modelPolicy missing ${target}`);
  for (const key of Object.keys(raw.modelPolicy)) if (!targets.includes(key)) throw new Error(`unknown modelPolicy target: ${key}`);
  if (!['low', 'medium', 'high', 'xhigh'].includes(raw.codexReasoningEffort)) throw new Error('invalid codexReasoningEffort');
  if (!Array.isArray(raw.needs) || !Array.isArray(raw.requiresEnforcement)) throw new Error('needs and requiresEnforcement must be lists');
  for (const need of raw.needs) if (!capabilities.has(need)) throw new Error(`unknown need: ${need}`);
  if (new Set(raw.needs).size !== raw.needs.length) throw new Error('duplicate need');
  for (const required of raw.requiresEnforcement) if (!raw.needs.includes(required)) throw new Error(`requiresEnforcement not in needs: ${required}`);
  if (new Set(raw.requiresEnforcement).size !== raw.requiresEnforcement.length) throw new Error('duplicate requiresEnforcement');
  const body = match[2].trim();
  if (!body) throw new Error('body required');
  return { schemaVersion: 1, id: raw.id, description: raw.description, tier: raw.tier, intent: raw.intent,
    modelPolicy: raw.modelPolicy, codexReasoningEffort: raw.codexReasoningEffort, needs: raw.needs, requiresEnforcement: raw.requiresEnforcement,
    body, sourcePath, sourceSha256: createHash('sha256').update(text).digest('hex') };
}
