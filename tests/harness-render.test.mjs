import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadRoles } from '../harness/inventory.mjs';
import { assertEnforcement } from '../harness/capabilities.mjs';
import { validateGeneratedSyntax } from '../harness/generated-syntax.mjs';
import * as codex from '../harness/targets/codex.mjs';
import * as claude from '../harness/targets/claude.mjs';
import * as opencode from '../harness/targets/opencode.mjs';
import * as antigravity from '../harness/targets/antigravity.mjs';

const root = path.resolve('.');
const adapters = [codex, claude, opencode, antigravity];
const compatibility = JSON.parse(await readFile('harness/compatibility.json', 'utf8'));
const roles = await loadRoles(root, 'core');
const planner = roles.find(role => role.id === 'planner');
const worker = roles.find(role => role.id === 'worker');
const verifier = roles.find(role => role.id === 'verifier');
const context = { compatibility, profile: 'core' };

// Parse the emitted YAML subset semantically; a regex key scan cannot catch a
// comment-truncated model or a deny rule attached to the wrong parent.
function parseRenderedFrontmatter(body) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(body);
  assert.ok(match, 'missing frontmatter delimiters');
  const result = {};
  let parent;
  for (const line of match[1].split('\n')) {
    const top = /^([A-Za-z]+):(?: (.*))?$/.exec(line);
    const nested = /^  ([a-z]+): (.*)$/.exec(line);
    const item = /^  - (.*)$/.exec(line);
    if (top) {
      parent = top[1];
      assert.ok(!Object.hasOwn(result, parent), `duplicate ${parent}`);
      result[parent] = top[2] === undefined ? null : parseScalar(top[2]);
    } else if (nested) {
      if (result[parent] === null) result[parent] = {};
      assert.ok(result[parent] && !Array.isArray(result[parent]) && typeof result[parent] === 'object', `invalid mapping parent ${parent}`);
      assert.ok(!Object.hasOwn(result[parent], nested[1]), `duplicate ${parent}.${nested[1]}`);
      result[parent][nested[1]] = parseScalar(nested[2]);
    } else if (item) {
      if (result[parent] === null) result[parent] = [];
      assert.ok(Array.isArray(result[parent]), `invalid list parent ${parent}`);
      result[parent].push(parseScalar(item[1]));
    } else throw new Error(`unsupported emitted YAML: ${line}`);
  }
  return result;
}

function parseScalar(raw) {
  if (raw.startsWith('"')) return JSON.parse(raw);
  const value = raw.replace(/\s+#.*$/, '');
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

test('all targets emit deterministic planner and worker paths without dropping canonical bodies', () => {
  for (const adapter of adapters) {
    assert.equal(typeof adapter.targetId, 'string');
    assert.deepEqual(adapter.declaredPaths([planner, worker]), [planner, worker].map(role =>
      `${adapter.outputRoot}/${role.id}${adapter.targetId === 'codex' ? '.toml' : adapter.targetId === 'antigravity' ? '/agent.md' : '.md'}`));
    for (const role of [planner, worker]) {
      const rendered = adapter.renderRole(role, context);
      assert.equal(rendered.path, adapter.declaredPaths([role])[0]);
      assert.ok(rendered.body.includes(role.body));
      assert.deepEqual(adapter.renderRole(role, context), rendered);
      assert.ok(rendered.capabilities.length >= role.needs.length);
      for (const report of rendered.capabilities) {
        assert.ok(['native', 'advisory-only', 'unsupported', 'not-applicable'].includes(report.status));
        for (const field of ['sourceField', 'capability', 'emittedConstruct', 'reason']) assert.equal(typeof report[field], 'string');
      }
    }
  }
});

test('all selected canonical IDs have exactly one target path each', () => {
  for (const adapter of adapters) {
    const paths = adapter.declaredPaths(roles);
    assert.equal(paths.length, roles.length);
    assert.equal(new Set(paths).size, roles.length);
    for (const role of roles) assert.ok(paths.some(item => item.includes(`/${role.id}`)));
  }
});

test('golden planner outputs use only documented native fields', async () => {
  for (const adapter of adapters) {
    const rendered = adapter.renderRole(planner, context);
    const fixture = await readFile(`tests/fixtures/harness/planner.${adapter.targetId}.${adapter.targetId === 'codex' ? 'toml' : 'md'}`, 'utf8');
    assert.equal(rendered.body, fixture.replace(/\r\n/g, '\n'));
    if (adapter.targetId === 'codex') {
      const keys = [...rendered.body.matchAll(/^([a-z_]+) = /gm)].map(match => match[1]);
      assert.deepEqual(keys, ['name', 'description', 'model', 'model_reasoning_effort', 'sandbox_mode', 'developer_instructions']);
    } else {
      assert.match(rendered.body, /^---\n[\s\S]*?\n---\n/);
      const frontmatter = rendered.body.split('\n---\n', 1)[0];
      const keys = [...frontmatter.matchAll(/^([A-Za-z]+):/gm)].map(match => match[1]);
      const allowed = compatibility.targets[adapter.targetId].renderedFields;
      for (const key of keys) assert.ok(allowed.includes(key), `${adapter.targetId}: ${key}`);
    }
  }
});

test('every planner adapter retains affected-area and verification planning duties', () => {
  for (const adapter of adapters) {
    const output = adapter.renderRole(planner, context).body;
    assert.match(output, /affected areas/i, adapter.targetId);
    assert.match(output, /verification/i, adapter.targetId);
  }
});

test('target-local explicit models are preserved and inherit is not a Codex translation', () => {
  const altered = { ...worker, modelPolicy: { ...worker.modelPolicy, claude: 'sonnet', opencode: 'anthropic/claude-sonnet-4', antigravity: 'pro' } };
  assert.match(codex.renderRole(altered, context).body, /^model = "gpt-6-sol"$/m);
  assert.match(claude.renderRole(altered, context).body, /^model: "sonnet"$/m);
  assert.match(opencode.renderRole(altered, context).body, /^model: anthropic\/claude-sonnet-4$/m);
  assert.match(antigravity.renderRole(altered, context).body, /^model: pro$/m);
  assert.doesNotMatch(opencode.renderRole(worker, context).body, /^model:/m);
});

test('all 15 Codex candidates follow canonical reasoning effort policy without changing registered agents', async () => {
  const expected = {
    'context-curator': 'high', 'environment-doctor': 'high', 'goal-manager': 'high',
    'impact-analyzer': 'medium', 'integrator': 'high', 'performance-analyzer': 'high',
    planner: 'high', 'preview-manager': 'high', 'release-manager': 'high', researcher: 'high',
    reviewer: 'high', 'security-auditor': 'high', supervisor: 'high', verifier: 'high', worker: 'medium',
  };
  const all = await loadRoles(root, 'all');
  assert.deepEqual(new Set(all.map(role => role.id)), new Set(Object.keys(expected)));
  const handOwnedEfforts = {
    'context-curator': 'low', 'environment-doctor': 'medium', 'preview-manager': 'low',
    'release-manager': 'medium', researcher: 'medium', verifier: 'medium',
  };
  for (const role of all) {
    if (role.id !== 'goal-manager') {
      const old = await readFile(path.join(root, `.codex/agents/${role.id}.toml`), 'utf8');
      const handOwnedEffort = handOwnedEfforts[role.id] || expected[role.id];
      assert.match(old, new RegExp(`^model_reasoning_effort = "${handOwnedEffort}"$`, 'm'));
    }
    assert.equal(role.codexReasoningEffort, expected[role.id], role.id);
    const body = codex.renderRole(role, { compatibility, profile: 'all' }).body;
    assert.match(body,
      new RegExp(`^model_reasoning_effort = "${expected[role.id]}"$`, 'm'), role.id);
    assert.equal(validateGeneratedSyntax('codex', body).model_reasoning_effort, expected[role.id]);
  }
});

test('enforcement rejects advisory, unsupported, absent, and duplicate capability reports', () => {
  const strict = { ...planner, needs: ['read', 'write'], requiresEnforcement: ['write'] };
  for (const status of ['advisory-only', 'unsupported', 'not-applicable']) {
    assert.throws(() => assertEnforcement(strict, [{ sourceField: 'requiresEnforcement', capability: 'write', status, emittedConstruct: 'prompt', reason: 'not a boundary' }]), /requiresEnforcement.*write/);
  }
  assert.throws(() => assertEnforcement(strict, []), /requiresEnforcement.*write/);
  assert.throws(() => assertEnforcement(strict, [
    { sourceField: 'needs', capability: 'write', status: 'native', emittedConstruct: 'x', reason: 'one' },
    { sourceField: 'needs', capability: 'write', status: 'native', emittedConstruct: 'y', reason: 'two' },
  ]), /duplicate.*write/);
  assert.doesNotThrow(() => assertEnforcement(strict, [{ sourceField: 'needs', capability: 'write', status: 'native', emittedConstruct: 'verified', reason: 'verified boundary' }]));
  for (const adapter of adapters) assert.throws(() => adapter.renderRole(strict, context), /requiresEnforcement.*write/);
});

test('read-only declarations never claim a verified write boundary', () => {
  for (const adapter of adapters) {
    const report = adapter.renderRole(planner, context).capabilities.find(item => item.capability === 'write');
    assert.ok(report);
    assert.notEqual(report.status, 'native');
  }
});

test('Codex body remains a single valid TOML string when canonical prose contains quotes and newlines', () => {
  const role = { ...planner, body: 'First "quoted" line.\r\nSecond \\ path.' };
  const output = codex.renderRole(role, context).body;
  assert.equal(output.match(/^developer_instructions = /gm)?.length, 1);
  assert.ok(output.includes(`developer_instructions = ${JSON.stringify(role.body)}\n`));
});

test('adapters report omitted web controls unsupported', () => {
  const role = { ...planner, needs: ['read', 'shell', 'delegate', 'web'] };
  for (const adapter of [claude, opencode, antigravity]) {
    const reports = adapter.renderRole(role, context).capabilities;
    for (const name of ['web']) {
      const report = reports.find(item => item.capability === name);
      assert.equal(report.status, 'unsupported', `${adapter.targetId}: ${name}`);
    }
  }
  const codexWeb = codex.renderRole(role, context).capabilities.find(item => item.capability === 'web');
  assert.equal(codexWeb.status, 'unsupported');
});

test('verifier candidates retain shell syntax without claiming unverified native shell', () => {
  for (const adapter of [claude, opencode, antigravity]) {
    const rendered = adapter.renderRole(verifier, context);
    const shell = rendered.capabilities.find(item => item.capability === 'shell');
    const write = rendered.capabilities.find(item => item.capability === 'write');
    assert.ok(rendered.body.includes(verifier.body));
    assert.equal(shell.status, adapter.targetId === 'claude' ? 'advisory-only' : 'unsupported', adapter.targetId);
    assert.notEqual(shell.emittedConstruct, 'none', adapter.targetId);
    assert.ok(write && write.status !== 'native', adapter.targetId);
  }
  assert.match(claude.renderRole(verifier, context).body, /^tools: Read, Grep, Glob, Bash$/m);
  assert.doesNotMatch(claude.renderRole(verifier, context).body, /^disallowedTools:.*Bash/m);
  assert.doesNotMatch(opencode.renderRole(verifier, context).body, /^  bash: deny$/m);
  assert.doesNotMatch(opencode.renderRole(verifier, context).capabilities.find(item => item.capability === 'write').emittedConstruct, /bash deny/);
  assert.match(antigravity.renderRole(verifier, context).body, /^  - run_command$/m);
  const strictShell = { ...verifier, requiresEnforcement: ['shell'] };
  for (const adapter of [opencode, antigravity]) {
    assert.equal(adapter.renderRole(worker, context).capabilities.find(item => item.capability === 'shell').status, 'unsupported');
    assert.throws(() => adapter.renderRole(strictShell, context), /requiresEnforcement shell/);
  }
});

test('OpenCode does not imply delegation from a default permission it never emits', () => {
  const role = { ...worker, needs: [...worker.needs, 'delegate'] };
  const rendered = opencode.renderRole(role, context);
  const report = rendered.capabilities.find(item => item.capability === 'delegate');
  assert.equal(report.status, 'unsupported');
  assert.equal(report.emittedConstruct, 'none');
});

test('Claude model values are exact or rejected rather than YAML comments', () => {
  const explicit = { ...worker, modelPolicy: { ...worker.modelPolicy, claude: 'claude-sonnet-4-5' } };
  assert.match(claude.renderRole(explicit, context).body, /^model: "claude-sonnet-4-5"$/m);
  const ambiguous = { ...worker, modelPolicy: { ...worker.modelPolicy, claude: 'sonnet # replaced' } };
  assert.throws(() => claude.renderRole(ambiguous, context), /invalid claude model/);
});

test('emitted YAML frontmatter parses to exact model, permissions, and tool values', () => {
  const claudePlanner = parseRenderedFrontmatter(claude.renderRole(planner, context).body);
  assert.equal(claudePlanner.name, 'planner');
  assert.equal(claudePlanner.model, 'inherit');
  assert.equal(claudePlanner.tools, 'Read, Grep, Glob');
  const claudeVerifier = parseRenderedFrontmatter(claude.renderRole(verifier, context).body);
  assert.equal(claudeVerifier.tools, 'Read, Grep, Glob, Bash');
  const opencodeVerifier = parseRenderedFrontmatter(opencode.renderRole(verifier, context).body);
  assert.deepEqual(opencodeVerifier.permission, { edit: 'deny' });
  const antigravityVerifier = parseRenderedFrontmatter(antigravity.renderRole(verifier, context).body);
  assert.equal(antigravityVerifier.subagent, true);
  assert.equal(antigravityVerifier.mainAgent, false);
  assert.deepEqual(antigravityVerifier.tools, ['view_file', 'grep_search', 'run_command']);
  const explicit = { ...worker, modelPolicy: { ...worker.modelPolicy, claude: 'claude-sonnet-4-5' } };
  assert.equal(parseRenderedFrontmatter(claude.renderRole(explicit, context).body).model, 'claude-sonnet-4-5');
});
