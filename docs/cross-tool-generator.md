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

The dry run reports collisions with hand-owned Codex paths. Check mode is expected to fail until selected outputs are owned and current. Validation is expected to report missing manifest entries and unverified native smoke; these are honest gates, not test-suite failures. Do not run ordinary sync or reviewed adoption against this checkout merely to clear those reports. The write path requires native smoke and verified skill discovery, and ownership checks reject unmarked collisions. Reviewed Codex adoption is a distinct `--adopt-reviewed <record>` mode restricted to `--targets codex --profile all`; no such record is included here. Version 1 records retain existing-file-only behavior. A version 2 record reviews each rendered path as `baselineState: "existing"` with its old hash or `baselineState: "absent"` with `oldSha256: null`, and each registration as `registrationState: "registered"` or `"absent"`. At least one existing file is required; an all-absent set must use ordinary sync. Adoption cannot combine with dry-run, check, or JSON mode. An absent registration is reported in `missingRegistrations`: generating its agent file does not edit `.codex/config.toml` or enable that role. Human review and a separate validated manual registration remain required.

For an owned-output conflict, preserve the dirty file and review its diff against the manifest-recorded bytes and canonical source; never force or silently overwrite it. A pending ordinary sync journal may be inspected and resumed with `--recover`. Version 2 journals mark adoption origin and bind the exact reviewed-record digest, so ordinary recovery refuses an adoption journal even if action kinds are altered. Legacy version 1 Codex journals have ambiguous origin and require manual reconciliation. After renewed review of an interrupted adoption, `--targets codex --profile all --recover --adopt-reviewed <same-reviewed-record>` verifies record identity, current render, config baseline, journal transitions, and exact before/after output bytes before resuming. Native readiness is required again. Any mismatch leaves the journal and files for manual reconciliation. Journals are local recovery evidence, not cryptographic authentication against arbitrary local-state rewriting.

Tests use disposable fixtures and synthetic manifests for output, ownership, adoption, recovery, and Node-free consumer copying. They do not certify native loading. A future adoption must review current hand-owned files one by one, resolve six canonical-versus-registered reasoning-effort differences (context-curator, environment-doctor, preview-manager, release-manager, researcher, verifier), establish each target's native evidence, and then create an approved migration record before any real-path write. The fifteenth role also needs its manual config-registration gate before it can be used.
