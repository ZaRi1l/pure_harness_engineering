#!/usr/bin/env node
import { cp, lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPreviewServer } from './preview-server.mjs';
import { findRoot } from './runtime-state.mjs';

const fixtureRuntime = fileURLToPath(new URL('../tests/fixtures/agent-network-demo/.ai/runtime/', import.meta.url));

export function demoRuntimePath(root) {
  return path.resolve(root, '.ai', 'demo', 'network-runtime');
}

async function assertDemoTarget(root, target) {
  const expected = demoRuntimePath(root);
  if (path.resolve(target) !== expected) throw new Error('unsafe demo runtime path');
  for (const parent of [path.resolve(root, '.ai'), path.resolve(root, '.ai', 'demo')]) {
    try { if ((await lstat(parent)).isSymbolicLink()) throw new Error('unsafe demo runtime path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return expected;
}

export async function resetDemo(root, target = demoRuntimePath(root)) {
  const exact = await assertDemoTarget(root, target);
  await rm(exact, { recursive: true, force: true });
}

export async function prepareDemo(root, fixture = fixtureRuntime, target = demoRuntimePath(root)) {
  const exact = await assertDemoTarget(root, target);
  await resetDemo(root, exact);
  await mkdir(path.dirname(exact), { recursive: true });
  await cp(fixture, exact, { recursive: true });
  return exact;
}

export async function runDemo(root, host = '127.0.0.1', port = Number(process.env.PURE_HARNESS_DEMO_PORT || 8766)) {
  const target = await prepareDemo(root);
  const server = await createPreviewServer(root, host, { runtimeDir: target });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  console.log(`Pure Harness network demo: http://${host}:${server.address().port}/`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = findRoot();
  const command = process.argv[2];
  try {
    if (command === 'serve') await runDemo(root);
    else if (command === 'reset') await resetDemo(root);
    else throw new Error(`unknown demo command: ${command || '(missing)'}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
