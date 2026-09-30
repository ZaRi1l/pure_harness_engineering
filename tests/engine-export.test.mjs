import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function git(...args) {
  const result = spawnSync('git', args, { cwd: new URL('..', import.meta.url), encoding: null, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || `git ${args.join(' ')} failed`);
  return result.stdout;
}

function archiveEntries(tar) {
  const entries = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    entries.push(header.toString('utf8', 0, 100).replace(/\0.*$/, ''));
    const size = Number.parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim(), 8);
    assert.ok(Number.isFinite(size), 'valid archive entry size');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test('tracked engine export excludes development Task Specs and memory', () => {
  const tree = git('write-tree').toString('utf8').trim();
  const entries = archiveEntries(git('archive', '--format=tar', tree));
  assert.ok(entries.includes('projects/example/project.json'), 'export contains the neutral project example');
  assert.deepEqual(entries.filter(name => /^\.ai\/(tasks|memory)\//.test(name)), []);
});
