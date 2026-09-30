#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagnoseProjectContext } from './project-context.mjs';

export async function inspectProjectBinding({ checkoutRoot, bindingPath, projectId } = {}) {
  const result = await diagnoseProjectContext({ checkoutRoot, bindingPath, projectId });
  return result.ok ? { ...result, projectId } : result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  const flags = { '--checkout': 'checkoutRoot', '--binding': 'bindingPath', '--project': 'projectId' };
  for (let index = 0; index < argv.length; index += 2) {
    const field = flags[argv[index]];
    if (!field || index + 1 >= argv.length || options[field] !== undefined) {
      console.error('arguments: expected --checkout <path> --binding <path> --project <id>');
      return 1;
    }
    options[field] = argv[index + 1];
  }
  const result = await inspectProjectBinding(options);
  (result.ok ? console.log : console.error)(`${result.code}: ${result.message}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
