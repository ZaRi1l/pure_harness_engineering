#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getScriptHarnessRoot } from './project-context.mjs';
import { applyProjectSetup, planProjectSetup, recoverProjectSetup } from '../harness/project-setup.mjs';

const flags = new Set(['--mode', '--source', '--target', '--profile', '--antigravity-hooks', '--apply']);
const targets = new Set(['codex', 'claude', 'opencode', 'antigravity']);
function parse(argv) {
  const options = Object.create(null);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--recover') {
      if (options.recover) throw new Error('duplicate --recover');
      options.recover = true;
      continue;
    }
    if (flag === '--plan') {
      if (options.plan) throw new Error('duplicate --plan');
      options.plan = true;
      continue;
    }
    if (!flags.has(flag) || options[flag] !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('invalid setup arguments');
    options[flag] = argv[++index];
  }
  if (options['--apply'] && Object.keys(options).length !== 1) throw new Error('--apply requires only a plan file');
  if (options.recover && Object.keys(options).length !== 1) throw new Error('--recover cannot be combined with setup options');
  if (options['--mode'] && !['new', 'existing'].includes(options['--mode'])) throw new Error('invalid mode');
  if (options['--target'] && !targets.has(options['--target'])) throw new Error('invalid target');
  if (options['--profile'] && !['core', 'all'].includes(options['--profile'])) throw new Error('invalid profile');
  if (options['--antigravity-hooks'] && (!['on', 'off'].includes(options['--antigravity-hooks']) || options['--target'] !== 'antigravity')) throw new Error('Antigravity hook option requires --target antigravity and on|off');
  if (options['--source'] && options['--mode'] !== 'existing') throw new Error('source requires --mode existing');
  if (options.plan && options['--mode'] === 'existing' && !options['--source']) throw new Error('existing mode requires source');
  return options;
}
async function configured(harnessRoot) {
  try { return JSON.parse(await readFile(path.join(harnessRoot, '.harness/config.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function describe(plan) {
  return [
    JSON.stringify(plan, null, 2),
    'Backups: managed overwritten bytes are retained under .harness/backups; setup rollback uses its journal.',
    'Verification limit: generated files do not prove native discovery, permissions, or hook dispatch for Codex, Claude, OpenCode, or Antigravity.',
    `To apply, enter exactly: apply ${plan.planSha256.slice(0, 12)}`,
  ].join('\n');
}
function nextSteps(io, mode) {
  io.stdout.write(`${mode === 'update' ? 'Existing runtime is preserved; do not rerun init.\n' : 'From the Harness root, run once: npm run init\n'}Then use: npm run status\nFor the live dashboard: npm run preview:live\n`);
}

export async function main(argv = process.argv.slice(2), io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  try {
    const options = parse(argv);
    const harnessRoot = io.harnessRoot ?? getScriptHarnessRoot(import.meta.url);
    if (options.recover) {
      try {
        const result = await recoverProjectSetup({ harnessRoot });
        io.stdout.write(`${JSON.stringify(result)}\n`);
        return 0;
      } catch {
        io.stderr.write('Recovery refused; manual review required. Inspect .harness/setup-journal.json and .harness/recovery-records. Retained staging data is not deleted.\n');
        return 1;
      }
    }
    if (options['--apply']) {
      const plan = JSON.parse(await readFile(path.resolve(options['--apply']), 'utf8'));
      const result = await applyProjectSetup({ harnessRoot, plan });
      io.stdout.write(`${JSON.stringify(result)}\n`);
      nextSteps(io, plan.mode);
      return 0;
    }
    let mode = options['--mode'];
    let source = options['--source'];
    let target = options['--target'];
    let profile = options['--profile'];
    const antigravityHooks = options['--antigravity-hooks'] === undefined ? undefined : options['--antigravity-hooks'] === 'on';
    const alreadyConfigured = await configured(harnessRoot);
    if (!mode && alreadyConfigured) mode = 'update';
    if (options.plan) {
      mode ??= 'new';
      target ??= 'codex';
      const plan = await planProjectSetup({ harnessRoot, mode, source, target, profile, antigravityHooks });
      io.stdout.write(`${JSON.stringify(plan)}\n`);
      return 0;
    }
    if (!io.stdin || !io.stdout) throw new Error('interactive setup requires stdin and stdout');
    const prompt = createInterface({ input: io.stdin, output: io.stdout });
    try {
      if (!mode) {
        const answer = (await prompt.question('Project mode [new/existing] (new): ')).trim().toLowerCase();
        mode = answer || 'new';
      }
      if (mode === 'existing' && !source) source = (await prompt.question('Existing local path or remote URL: ')).trim();
      if (!target) target = (await prompt.question('Target [codex/claude/opencode/antigravity] (codex): ')).trim().toLowerCase() || 'codex';
      if (!profile) {
        const fallback = mode === 'update' ? alreadyConfigured?.profile ?? 'core' : 'all';
        profile = (await prompt.question(`AI profile [all/core] (${fallback}): `)).trim().toLowerCase() || fallback;
      }
      const plan = await planProjectSetup({ harnessRoot, mode, source, target, profile, antigravityHooks });
      io.stdout.write(`${describe(plan)}\n`);
      if (plan.conflicts.length) return 1;
      const answer = (await prompt.question('Confirmation: ')).trim();
      if (answer !== `apply ${plan.planSha256.slice(0, 12)}`) { io.stderr.write('Setup not applied: confirmation did not match.\n'); return 1; }
      const result = await applyProjectSetup({ harnessRoot, plan });
      io.stdout.write(`${JSON.stringify(result)}\n`);
      nextSteps(io, plan.mode);
      return 0;
    } finally { prompt.close(); }
  } catch (error) {
    io.stderr.write(`Setup failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
