#!/usr/bin/env node
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aggregateCodexRollouts } from './codex-rollout-telemetry.mjs';
import { RuntimeStore, contextFromArgs } from './runtime-state.mjs';

const fail = category => { throw Object.assign(new Error(category), { category }); };

export async function importTelemetry(argv) {
  let context, args;
  try { ({ context, args } = await contextFromArgs(argv)); }
  catch { fail('invalid_context'); }
  const files = [];
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== '--file' || typeof args[index + 1] !== 'string' || !path.isAbsolute(args[index + 1])) fail('invalid_arguments');
    files.push(args[index + 1]);
  }
  if (!files.length) fail('invalid_arguments');
  for (const file of files) {
    try { if (!(await lstat(file)).isFile()) fail('invalid_file'); }
    catch { fail('invalid_file'); }
  }
  const store = new RuntimeStore(context);
  let links;
  try { links = await store.readChildLinks(); }
  catch { fail('invalid_links'); }
  let document;
  try { document = await aggregateCodexRollouts(files, { projectId: context.projectId, links }); }
  catch (error) {
    if (Number.isSafeInteger(error.lineNumber)) throw Object.assign(new Error('malformed_rollout'), { category: 'malformed_rollout', lineNumber: error.lineNumber });
    fail('invalid_rollout');
  }
  let previous;
  try { previous = await store.readTelemetry(); }
  catch { fail('invalid_telemetry'); }
  if (previous.observed_at) {
    const withoutObservation = value => JSON.stringify({ ...value, observed_at: null });
    if (withoutObservation(previous) === withoutObservation(document)) document.observed_at = previous.observed_at;
  }
  try { await store.replaceTelemetry(document); }
  catch { fail('replace_failed'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  importTelemetry(process.argv.slice(2)).catch(error => {
    console.error(error.lineNumber ? `${error.category} line ${error.lineNumber}` : (error.category || 'import_failed'));
    process.exitCode = 1;
  });
}
