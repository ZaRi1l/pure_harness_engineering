import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

export async function fixedFixture({ configured = true } = {}) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'fixed-project-context-'));
  const harnessRoot = path.join(temporaryRoot, 'harness');
  const projectRoot = path.join(harnessRoot, 'project');
  const linkedRoot = path.join(temporaryRoot, 'linked');
  const configPath = path.join(harnessRoot, '.harness', 'config.json');
  await mkdir(projectRoot, { recursive: true });
  git(harnessRoot, 'init', '-q');
  git(projectRoot, 'init', '-q');
  git(projectRoot, 'config', 'user.name', 'Fixture');
  git(projectRoot, 'config', 'user.email', 'fixture@example.test');
  await writeFile(path.join(projectRoot, 'README'), 'fixture child\n');
  git(projectRoot, 'add', 'README');
  git(projectRoot, 'commit', '-qm', 'fixture child');
  git(projectRoot, 'worktree', 'add', '-qb', 'linked-fixture', linkedRoot);
  if (configured) {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      version: 1,
      layout: 'single-project',
      projectPath: 'project',
      target: 'codex',
      setupId: '123e4567-e89b-42d3-a456-426614174000',
      createdAt: '2026-10-08T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    }));
  }
  return { harnessRoot, projectRoot, linkedRoot, configPath };
}
