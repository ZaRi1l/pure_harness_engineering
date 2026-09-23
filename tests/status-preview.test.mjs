import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStatus } from '../scripts/status.mjs';
import { renderStaticPreview } from '../scripts/generate-preview.mjs';

const snapshot = { status: { current_goal: 'Ship <safe>', phase: 'execution', progress: { completed: 1, total: 2 }, active_agents: [], verification: { checks: [], status: 'passed' }, warnings: [{ message: 'Needs review' }] }, tasks: { tasks: [{ title: 'Implement', status: 'completed', owner: 'worker' }] }, claims: { claims: [{ agent_id: 'worker', scopes: ['src/backend/'] }] } };
test('status CLI renders claims and watchdog warnings', () => { const text = renderStatus(snapshot); assert.match(text, /src\/backend/); assert.match(text, /Needs review/); });
test('static preview renders snapshot safely', () => { const html = renderStaticPreview(snapshot); assert.match(html, /Ship &lt;safe&gt;/); assert.match(html, /Write Claims/); });
