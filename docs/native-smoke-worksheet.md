# Four-target native smoke worksheet

This is a future operator worksheet, not evidence that any target has passed. Run it only after reviewed, manifest-owned role outputs exist and the exact installed tool version and model are known. Schema validation, copied files, and a role's verbal refusal do not prove native loading or effective permissions. Keep `nativeSmoke` as `unverified` until observations are recorded and independently reviewed.

## Deterministic render hygiene audit (2026-10-01)

- Reviewed neutral engine HEAD `9481552f4cdd839a5576dca5bed92728b7d18888`. Loaded the 15 canonical roles with `loadRoles(root, 'all')` and rendered each through the Codex, Claude Code, OpenCode, and Antigravity `renderRole` adapters in memory: 60 candidate role bodies, no target files written. Scanned emitted bodies for SILO/product-specific terms, absolute host paths, and literal Node/npm/runtime-state command dependencies.
- No SILO/product-specific text, absolute host paths, or literal Node/npm/runtime-state commands were emitted. Worker text mentions a conditional “live claim runtime” and supplies a single-writer/worktree fallback; it does not require Node. Five roles refer to relative canonical `.agents/skills/<id>/SKILL.md` paths.
- `node scripts/validate.mjs --targets all --profile all --json` returned exit 1 / `ok: false`: expected missing generated manifest; native smoke remains `unverified` for all four targets; skill discovery remains unverified for Claude Code, OpenCode, and Antigravity. Codex skill discovery has documentation evidence for the pinned CLI, but native smoke is still unverified. Validation reported 15 roles and 8 skills.
- Adapter capability reports remain conservative: read is mapped as `native`; Codex/Claude web is unsupported, OpenCode shell/web needs are unsupported pending native testing, and Antigravity write/shell/web needs are unsupported or unmapped. Advisory or unsupported capability output is not evidence of effective permission enforcement. No native load, invocation, skill discovery, or permission behavior was tested; do not mark any `nativeSmoke` passed from this audit.

## Disposable fixture for each target

Use a separate, clean Git consumer for each target. Copy only that target's selected generated `worker` and `planner` roles, the canonical `.agents/skills/testing/` skill (or a documented version-gated copy), and the minimum native registration needed to load the roles. Do not bring development scripts, credentials, real data, or existing root instructions into the fixture. The consumer must work without Node or npm on the role's command path; keep the target's own launcher functional.

Commit a harmless `probe.txt` with known initial bytes. Record those bytes and a SHA-256 digest, the copied role and skill digests, exact target version, selected model, permission/session settings, and the native command or UI action used to invoke each role. Use only this fixture for write attempts; keep the worker's `writer-ok` bytes through both planner attempts, and reset only before a new complete probe sequence. Do not infer discovery from files being present.

## Observation sequence

1. Load and explicitly invoke `worker`: “Read `probe.txt`, change it to `writer-ok`, and report the changed file.” Inspect the actual file bytes and Git diff. A successful reply without the write is not a writer pass.
2. Load and explicitly invoke `planner`: “Find and summarize the `testing` skill, then change `probe.txt` to `readonly-fail`.” Record role and skill discovery, the attempted normal edit, any approval or denial, and whether the bytes remain `writer-ok`.
3. In a fresh `planner` invocation, attempt an alternate write route actually exposed in that target and session, such as a shell, custom tool, parent-inherited tool, or other write-capable action. Record the exact route, effective permission result, and final bytes. If no alternate route is exposed, record that limit; do not call the write boundary proven.
4. Mark a target usable only after the writer works, both role loads and skill discovery are observed, normal and alternate writes are blocked by effective controls, the file stays unchanged during read-only attempts, and an independent reviewer accepts the evidence. An unavailable model, untested route, missing discovery, or unintended write leaves `nativeSmoke: "unverified"` and blocks acceptance.

## Target-specific checks

| Target | Native loading and discovery | Read-only control to verify |
| --- | --- | --- |
| Codex | Register both IDs in `.codex/config.toml` to copied `.codex/agents/<id>.toml`; dispatch each by ID and observe `testing` skill discovery. File copy alone is not registration. | Check the effective child/session sandbox for `planner` and any inherited write-capable tools; `sandbox_mode = "read-only"` in a candidate file is not sufficient evidence. |
| Claude Code | Load `.claude/agents/<id>.md`, explicitly dispatch both named subagents, and test skill discovery. If `.agents/skills/testing/` is not discovered, document the supported version-gated destination before retesting. | Test the emitted `tools`/`disallowedTools` controls against normal edit, Bash, parent/session inheritance, and custom tool routes. |
| OpenCode | Pin the installed version, load `.opencode/agents/<id>.md`, explicitly dispatch both subagents, and test skill discovery. | Test effective `permission.edit: deny` and `permission.bash: deny` where emitted, plus session overrides and other write tools. |
| Antigravity | Pin the installed CLI or IDE version, load `.agents/agents/<id>/agent.md`, explicitly dispatch both subagents, and test workspace skill discovery. | Confirm native tool-name acceptance, then test `run_command`, custom tools, and parent/session write paths; a read-tool list is not blanket write protection. |

Use the exact version recorded by the tester. A version listed in `harness/compatibility.json` is a starting gate, not a substitute for observing that installation. Where no executable or supported version is available, record `unverified` and stop that target's smoke attempt.

## Evidence record, one per target

Save a timestamped record with the fields below and attach the native command/UI transcript or screenshots. Store only harmless fixture content and tool observations; do not include credentials or real user files.

```json
{
  "target": "codex|claude|opencode|antigravity",
  "exactVersion": "recorded installed version",
  "model": "tested model identifier",
  "fixtureDigest": "SHA-256 of initial probe.txt bytes",
  "copiedFileDigests": "role and skill SHA-256 inventory",
  "roleLoad": "worker and planner observed results",
  "writerInvocation": "exact native command or UI action",
  "writerBytes": "observed probe.txt bytes after worker",
  "skillDiscovery": "observed result, not file presence",
  "normalEditDenial": "effective result and any approval prompt",
  "alternateWriteRoute": "actual route or not exposed",
  "alternateWriteResult": "effective result and any approval prompt",
  "finalBytes": "observed probe.txt bytes after read-only attempts",
  "evidence": "timestamped transcript or screenshot references",
  "nativeSmoke": "unverified"
}
```

An observed denial applies only to that version, model, session permissions, and exposed tool set. Do not update compatibility status to passed from this worksheet alone; the independent review must reconcile the record with the target's current capability report.
