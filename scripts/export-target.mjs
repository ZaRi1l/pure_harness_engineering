#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportBundle } from '../harness/export-bundle.mjs';

function optionsFrom(args) {
  const options = {}, seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--source', '--output', '--targets', '--profile'].includes(flag) || seen.has(flag)
        || !value || value.startsWith('--')) throw new Error(`invalid option: ${flag}`);
    seen.add(flag);
    options[flag.slice(2)] = value;
  }
  if (!options.output) throw new Error('--output is required');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await exportBundle(optionsFrom(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
