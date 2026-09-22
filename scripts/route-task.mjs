#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROUTES = { small: ['worker'], medium: ['planner', 'worker', 'verifier', 'reviewer'], large: ['planner', 'impact-analyzer', 'worker', 'integrator', 'verifier', 'reviewer', 'supervisor'] };
export function rolesFor(size) { const roles = ROUTES[String(size).toLowerCase()]; if (!roles) throw new Error(`unknown task size: ${size}`); return [...roles]; }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) { const size = process.argv[2]; try { console.log(JSON.stringify({ size, roles: rolesFor(size) }, null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
