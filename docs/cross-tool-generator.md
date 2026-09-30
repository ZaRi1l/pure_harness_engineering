# Cross-tool role generator (staged)

The canonical, product-neutral role sources are `harness/agents/<id>.md`. Repository-side Node scripts render candidate agent files for Codex, Claude Code, OpenCode, and Antigravity. The generator runs at build time; a consumer of generated roles does not need Node or these scripts. Canonical skills remain in `.agents/skills/`.

This checkout contains 15 canonical role sources, including `goal-manager`, but its existing Codex config registers only 14 hand-owned agents. The config, those 14 TOMLs, hooks, root instructions, and eight skills are not generated or adopted by this stage. There is no checked-in adoption record or generated manifest. Do not treat these candidates as an installed four-tool distribution.

## Evidence and gates

`harness/compatibility.json` records this checkout's inventory and locally observed Codex CLI `0.153.4` and Claude Code `2.1.280`; OpenCode and Antigravity were not found locally. All four native smoke states remain `unverified`. Codex's pinned documentation establishes `.agents/skills/` discovery, but native role loading, effective permissions, and actual invocation are not smoke-proven. Other targets' skill discovery is not accepted as native-ready by the current generator. A copied skill file alone is not discovery evidence.

Render selection is explicit: `--targets codex`, `claude`, `opencode`, `antigravity`, a comma-separated subset, or `all`, plus `--profile core` (five roles/four skills) or `--profile all` (15 roles/eight skills). The target model must be supported and available to the user's account. `inherit` leaves model selection to the target where supported; it does not prove entitlement. Prompt wording alone does not enforce read-only behavior.

Use read-only inspection in this checkout:

```text
node scripts/detect-targets.mjs --json
node scripts/sync.mjs --targets codex --profile core --dry-run
node scripts/sync.mjs --targets codex --profile core --check
node scripts/validate.mjs --targets codex --profile core --json
```

The dry run reports collisions with hand-owned Codex paths. Check mode is expected to fail until selected outputs are owned and current. Validation is expected to report missing manifest entries and unverified native smoke; these are honest gates, not test-suite failures. Do not run ordinary sync or reviewed adoption against this checkout merely to clear those reports. The write path requires native smoke and verified skill discovery, and ownership checks reject unmarked collisions. Reviewed Codex adoption is a distinct `--adopt-reviewed <record>` mode that requires a complete reviewed record and exact baseline hashes; no such record is included here.

Tests use disposable fixtures and synthetic manifests for output, ownership, adoption, recovery, and Node-free consumer copying. They do not certify native loading. A future adoption must review current hand-owned files one by one, resolve six canonical-versus-registered reasoning-effort differences (context-curator, environment-doctor, preview-manager, release-manager, researcher, verifier), establish each target's native evidence, and then create an approved migration record before any real-path write.
