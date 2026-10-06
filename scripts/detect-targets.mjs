#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const markers = {
  codex: ['.codex/config.toml', '.codex/agents'],
  claude: ['.claude/agents'],
  opencode: ['.opencode/agents'],
  antigravity: ['.agents/agents'],
};

export async function detectTargets(root, explicitFlags = []) {
  if (!Array.isArray(explicitFlags) || new Set(explicitFlags).size !== explicitFlags.length || explicitFlags.some(name => !Object.hasOwn(markers, name))) {
    throw new Error('invalid explicit target flags');
  }
  const rows = [];
  for (const target of Object.keys(markers)) {
    const evidence = [];
    for (const marker of markers[target]) {
      try {
        const metadata = await stat(path.join(root, marker));
        if (marker.endsWith('.toml') ? metadata.isFile() : metadata.isDirectory()) evidence.push(marker);
      }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (explicitFlags.includes(target)) evidence.push(`--present ${target}`);
    rows.push({ target, present: evidence.length > 0, evidence });
  }
  return rows;
}

function parseArgs(args) {
  let root = process.cwd(), explicitFlags = [];
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--json') continue;
    if (!['--root', '--present'].includes(flag)) throw new Error(`unknown option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--root') root = value;
    else explicitFlags = value.split(',');
  }
  return { root, explicitFlags };
}

async function main(args) {
  try {
    const { root, explicitFlags } = parseArgs(args);
    process.stdout.write(`${JSON.stringify(await detectTargets(root, explicitFlags), null, 2)}\n`);
  }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2));
