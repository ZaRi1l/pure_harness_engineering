#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBundle } from '../harness/install-bundle.mjs';

export function parseArgs(argv) {
  const parsed = { mode: 'plan', trial: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!['--bundle', '--project', '--plan', '--apply', '--check', '--rollback', '--trial'].includes(flag) || seen.has(flag)) throw new Error(`unknown or duplicate option: ${flag}`);
    seen.add(flag);
    if (['--bundle', '--project'].includes(flag)) {
      const value = argv[++index];
      if (!value || !path.isAbsolute(value)) throw new Error(`${flag} requires an absolute path`);
      parsed[flag === '--bundle' ? 'bundleRoot' : 'projectRoot'] = path.resolve(value);
    } else if (flag === '--trial') parsed.trial = true;
    else {
      if (parsed._modeSet) throw new Error('select only one install mode');
      parsed.mode = flag.slice(2);
      parsed._modeSet = true;
    }
  }
  if (!parsed.bundleRoot || !parsed.projectRoot) throw new Error('--bundle and --project are required');
  if (parsed.trial && !['plan', 'apply'].includes(parsed.mode)) throw new Error('--trial applies only to plan/apply');
  delete parsed._modeSet;
  return parsed;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const result = await installBundle(parseArgs(args));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
