import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { diagnoseProjectContext, loadProjectContext } from './project-context.mjs';

const REQUIRED_HOOKS = ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop'];
const REQUIRED_COMMANDS = ['status', 'preview', 'claim', 'release-claim'];

export async function inventoryRuntime(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('legacy runtime root must be absolute');
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) throw new Error('legacy runtime root is a link');
  if (!rootInfo.isDirectory()) throw new Error('legacy runtime root is not a directory');
  const canonical = await realpath(root);
  const entries = [];
  async function visit(directory, relative = '') {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('legacy runtime contains a link');
      const item = relative ? `${relative}/${name}` : name;
      if (info.isDirectory()) {
        entries.push({ path: item, type: 'directory' });
        await visit(file, item);
      } else if (info.isFile()) {
        const bytes = await readFile(file);
        entries.push({ path: item, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw new Error('legacy runtime contains an unsupported entry');
    }
  }
  await visit(canonical);
  return entries;
}

export async function checkCutover(options = {}) {
  const checks = [], failures = [];
  const diagnostic = await diagnoseProjectContext({ projectId: options.projectId, checkoutRoot: options.checkoutRoot, bindingPath: options.bindingPath });
  if (diagnostic.ok) checks.push('binding validated for selected project');
  else failures.push(`binding: ${diagnostic.code}`);
  if (diagnostic.ok) {
    try {
      const context = await loadProjectContext({ projectId: options.projectId, checkoutRoot: options.checkoutRoot, bindingPath: options.bindingPath });
      const oldRoot = await realpath(options.legacyRuntimeRoot);
      const selected = path.resolve(context.paths.runtime);
      const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
      const old = normalize(oldRoot), next = normalize(selected);
      if (old === next || old.startsWith(`${next}${path.sep}`) || next.startsWith(`${old}${path.sep}`)) failures.push('legacy and selected runtimes are not separate');
      else checks.push('legacy and selected runtimes are separate');
    } catch { failures.push('legacy and selected runtime separation unverified'); }
  }
  if (options.validationReport?.ok === true && !options.validationReport.failures?.length) checks.push('caller-supplied validation report claims pass');
  else failures.push('validation report missing or failed');
  const discovery = options.discoveryEvidence;
  if (Array.isArray(discovery?.roles) && discovery.roles.length && Array.isArray(discovery?.skills) && discovery.skills.length) checks.push('caller-supplied role and skill discovery list present');
  else failures.push('fresh-session discovery evidence missing');
  if (REQUIRED_HOOKS.every(event => discovery?.hookEvents?.includes(event))) checks.push('caller-supplied five-hook list present');
  else failures.push('fresh-session hook dispatch evidence missing');
  const quiet = options.quiescence;
  if (quiet && quiet.legacySessions === 0 && quiet.legacyWriters === 0 && quiet.activeClaims === 0) checks.push('caller-supplied quiescence counts are zero');
  else failures.push('legacy session, writer, or claim quiescence not proved');
  if (REQUIRED_COMMANDS.every(command => options.verifiedCommands?.includes(command))) checks.push('caller-supplied command list present');
  else failures.push('required command evidence missing');
  // Caller-provided lists and counts are claims, not independently observed
  // native-session or runtime evidence. Keep the operator gate closed until a
  // trusted evidence reader is implemented and reviewed.
  failures.push('native fresh-session and quiescence evidence not independently validated');
  try {
    if (!Array.isArray(options.legacyInventory)) throw new Error('missing inventory');
    const actual = await inventoryRuntime(options.legacyRuntimeRoot);
    if (JSON.stringify(actual) !== JSON.stringify(options.legacyInventory)) throw new Error('changed inventory');
    checks.push('legacy runtime names, sizes, and hashes unchanged');
  } catch { failures.push('legacy runtime inventory missing, changed, or unreadable'); }
  return { ok: failures.length === 0, checks, failures };
}
