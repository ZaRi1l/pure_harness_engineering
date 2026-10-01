import { createHash } from 'node:crypto';

export const TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed', 'cancelled']);
const FIELD_NAMES = ['title', 'status', 'branch'];
const edgeWhitespace = /^[\s\u200b-\u200d\u2060]+|[\s\u200b-\u200d\u2060]+$/gu;
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/u;

const trimLabel = value => value.replace(edgeWhitespace, '');

export function validateTaskFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== FIELD_NAMES.length ||
      !Object.keys(value).every(key => FIELD_NAMES.includes(key))) throw new Error('invalid task fields');
  if (typeof value.title !== 'string') throw new Error('invalid task title');
  const title = trimLabel(value.title);
  if (!title || title.length > 300) throw new Error('invalid task title');
  if (!TASK_STATUSES.has(value.status)) throw new Error('invalid task status');
  let branch = null;
  if (value.branch !== null) {
    if (typeof value.branch !== 'string' || controlCharacters.test(value.branch)) throw new Error('invalid task branch');
    branch = trimLabel(value.branch);
    if (!branch || branch.length > 120) throw new Error('invalid task branch');
  }
  return { title, status: value.status, branch };
}

export function taskRevision(task) {
  if (typeof task.revision === 'string' && task.revision) return task.revision;
  const canonical = [task.title ?? null, task.status ?? null, task.branch ?? null, task.created_at ?? null, task.updated_at ?? null];
  return `legacy-${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function safeTask(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    branch: task.branch ?? null,
    ...(task.owner !== undefined ? { owner: task.owner } : {}),
    created_at: task.created_at,
    updated_at: task.updated_at,
    revision: taskRevision(task),
  };
}
