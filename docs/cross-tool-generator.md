# Cross-tool role generator (staged)

The canonical, product-neutral role sources are `harness/agents/<id>.md`. Repository-side Node scripts render candidate agent files for Codex, Claude Code, OpenCode, and Antigravity. The generator runs at build time; a consumer of generated roles does not need Node or these scripts. Canonical skills remain in `.agents/skills/`.

This checkout contains 15 canonical role sources, including `goal-manager`, but its existing Codex config registers only 14 hand-owned agents. The existing config, those 14 TOMLs, hooks, and root instructions are not adopted by this stage. There is no checked-in adoption record or sync-generated manifest. A separate candidate bundle can now be exported without changing this checkout; do not treat it as a verified four-tool distribution.

## Generate a candidate bundle now

From the engine checkout, choose one target (or a comma-separated subset, or `all`) and a **new absolute output directory**. `core` contains five roles and four skills; `all` contains 15 roles and eight skills. Keep the engine, bundle, and consumer checkout separate and nonnested.

```powershell
$EngineRoot = 'C:\tools\pure-harness'
$BundleRoot = 'C:\work\pure-harness-claude-candidate' # must not already exist
$Target = 'claude' # codex / claude / opencode / antigravity / all
Set-Location $EngineRoot
node scripts/export-target.mjs --output $BundleRoot --targets $Target --profile core
if ($LASTEXITCODE -ne 0) { throw 'Candidate export failed' }
```

For all four targets at once, choose a different new output path and run `node scripts/export-target.mjs --output C:\work\pure-harness-all-candidate --targets all --profile all`.

Use `--source <absolute-engine-path>` only when the source is not the script's own checkout. The export does not alter the source or merge into an existing output. It writes raw target-native role files (Codex TOML or leading YAML metadata for the others), selected canonical `.agents/skills/`, and Claude's `.claude/skills/` when Claude is selected. Codex also gets a candidate `.codex/config.toml`. `bundle-manifest.json` records exact file hashes and `status: unverified`. It does **not** supply root instructions, hooks, project runtime binding, task telemetry, or an existing project's config merge.

To inspect an install without touching an existing project, use a disposable empty Git root with no remotes. The installer rejects a nonroot project path, path collisions, modified owned files, and a non-disposable `--apply --trial` target. `--plan` is read-only; `--apply --trial` is the only permitted apply path for this unverified bundle. Run each step only after the previous succeeds:

```powershell
$TrialRoot = 'C:\work\pure-harness-consumer-trial' # must not already exist
if (Test-Path -LiteralPath $TrialRoot) { throw 'Choose a new trial path' }
New-Item -ItemType Directory -Path $TrialRoot | Out-Null
git -C $TrialRoot init
if ($LASTEXITCODE -ne 0) { throw 'Git init failed' }
if (@(git -C $TrialRoot remote).Count -ne 0) { throw 'Trial checkout has a remote' }
Set-Location $EngineRoot
node scripts/install-target.mjs --bundle $BundleRoot --project $TrialRoot --plan --trial
if ($LASTEXITCODE -ne 0) { throw 'Install plan failed' }
node scripts/install-target.mjs --bundle $BundleRoot --project $TrialRoot --apply --trial
if ($LASTEXITCODE -ne 0) { throw 'Trial apply failed' }
node scripts/install-target.mjs --bundle $BundleRoot --project $TrialRoot --check
if ($LASTEXITCODE -ne 0) { throw 'Installed-file check failed' }
```

Open `$TrialRoot` in the selected application and follow the [native smoke worksheet](native-smoke-worksheet.md) if you want to test native behavior; the script sequence itself does not launch or validate any tool. When finished, roll back the unchanged installed files:

```powershell
node scripts/install-target.mjs --bundle $BundleRoot --project $TrialRoot --rollback
if ($LASTEXITCODE -ne 0) { throw 'Rollback stopped; inspect files before retrying' }
```

Rollback removes only installer-owned, unchanged files and its state, not the trial Git repository. The existing `sync` gate remains separate and closed until its native evidence and ownership requirements are met.

## Evidence and gates

`harness/compatibility.json` records this checkout's inventory and locally observed Codex CLI `0.153.4` and Claude Code `2.1.280`; OpenCode and Antigravity were not found locally. All four native smoke states remain `unverified`. Codex's pinned documentation establishes `.agents/skills/` discovery, but native role loading, effective permissions, and actual invocation are not smoke-proven. Other targets' skill discovery is not accepted as native-ready by the current generator. A copied skill file alone is not discovery evidence.

The [four-target native smoke worksheet](native-smoke-worksheet.md) lists the future disposable-fixture checks and evidence fields. It is a procedure, not an executed smoke record.

| Target | Local version evidence | Writer/read-only invocation and denied edits | Skill discovery in a clean consumer |
| --- | --- | --- | --- |
| Codex | `codex-cli 0.153.4` | Unverified | Documented `.agents/skills/` path; native smoke unverified |
| Claude Code | `2.1.280` | Unverified | Unverified for `.agents/skills/` |
| OpenCode | No local executable/version pinned | Unverified | Documented path only; native smoke unverified |
| Antigravity | No local executable/version pinned | Unverified | Documented path only; native smoke unverified |

Before accepting any target, load a writer and read-only role in a clean consumer, test a denied edit and an alternate write route, and confirm skill discovery on the recorded tool version. Record effective permission results; prompt refusal alone is not enforcement evidence. Missing tools or untested routes remain `unverified`.

Render selection is explicit: `--targets codex`, `claude`, `opencode`, `antigravity`, a comma-separated subset, or `all`, plus `--profile core` (five roles/four skills) or `--profile all` (15 roles/eight skills). The target model must be supported and available to the user's account. `inherit` leaves model selection to the target where supported; it does not prove entitlement. Prompt wording alone does not enforce read-only behavior.

Use read-only inspection in this checkout:

```text
node scripts/detect-targets.mjs --json
node scripts/sync.mjs --targets codex --profile core --dry-run
node scripts/sync.mjs --targets codex --profile core --check
node scripts/validate.mjs --targets codex --profile core --json
```

After native smoke, reviewed ownership or adoption, and approval of the migration, the all-profile generation commands are:

```text
node scripts/sync.mjs --targets all --profile all
node scripts/sync.mjs --targets all --profile all --check
```

The normal sync above is a future approved-migration step, not a command expected to pass in this checkout today. All native smoke states remain `unverified`, non-Codex skill discovery is unverified, existing Codex outputs are hand-owned, and no committed generated manifest exists. Do not bypass these gates to make distribution appear ready.

The dry run reports collisions with hand-owned Codex paths. Check mode is expected to fail until selected outputs are owned and current. Validation is expected to report missing manifest entries and unverified native smoke; these are honest gates, not test-suite failures. Do not run ordinary sync or reviewed adoption against this checkout merely to clear those reports. The write path requires native smoke and verified skill discovery, and ownership checks reject unmarked collisions. Reviewed Codex adoption is a distinct `--adopt-reviewed <record>` mode restricted to `--targets codex --profile all`; no such record is included here. Version 1 records retain existing-file-only behavior. A version 2 record reviews each rendered path as `baselineState: "existing"` with its old hash or `baselineState: "absent"` with `oldSha256: null`, and each registration as `registrationState: "registered"` or `"absent"`. At least one existing file is required; an all-absent set must use ordinary sync. Every v2 `registrationState: "absent"` entry requires `registrationReview: { "configSha256": "<same config hash>", "reviewerDecision": "approved" }`. This is an explicit human decision bound to the reviewed config bytes, not parser proof of semantic absence. Adoption and successful reviewed recovery report those roles in `manualRegistrationReview`. The generator never edits `.codex/config.toml`. File generation alone may make a role available if the config already registers it, so a mistaken human decision is consequential. Do not perform a real migration until user approval and native Codex loading have been verified. Adoption cannot combine with dry-run, check, or JSON mode.

For an owned-output conflict, preserve the dirty file and review its diff against the manifest-recorded bytes and canonical source; never force or silently overwrite it. A pending ordinary sync journal may be inspected and resumed with `--recover`. Version 2 journals mark adoption origin and bind the exact reviewed-record digest, so ordinary recovery refuses an adoption journal even if action kinds are altered. Legacy version 1 Codex journals have ambiguous origin and require manual reconciliation. After renewed review of an interrupted adoption, `--targets codex --profile all --recover --adopt-reviewed <same-reviewed-record>` verifies record identity, current render, config baseline, journal transitions, and exact before/after output bytes before resuming. Native readiness is required again. Any mismatch leaves the journal and files for manual reconciliation. Journals are local recovery evidence, not cryptographic authentication against arbitrary local-state rewriting.

## Distribute only after the gates pass

A reviewed distribution consists of the selected paths in `harness/generated-manifest.json` and the canonical `.agents/skills/` directories referenced by those roles. The producer needs Node for sync/check; the consumer does not need Node, `npm`, `scripts/`, `.ai/runtime/`, or producer hooks. Generated prompts must not depend on localhost or producer runtime commands. Copying files does not prove native discovery or permission enforcement.

For a reviewed, passing `--targets all --profile all` manifest, run this PowerShell from the **producer** repository. Replace the consumer path with an existing destination. It preflights all 60 role paths and eight skill directories before copying, refuses collisions, and does not touch root `AGENTS.md`, `CLAUDE.md`, or hooks:

```powershell
node scripts/sync.mjs --targets all --profile all --check
if ($LASTEXITCODE -ne 0) { throw 'Generator check failed; stop before copying' }
$sourceRoot = (Resolve-Path '.').Path
$consumerRoot = (Resolve-Path 'C:\path\to\consumer').Path
$manifest = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'harness/generated-manifest.json') | ConvertFrom-Json
$rolePaths = @($manifest.entries | ForEach-Object { $_.path })
if ($rolePaths.Count -ne 60 -or @($rolePaths | Select-Object -Unique).Count -ne 60) {
  throw 'Expected 60 unique role paths (15 roles for each of four targets)'
}
$roleId = '[a-z][a-z0-9-]*'
$allowedRoleRoot = "^((\.codex/agents/$roleId\.toml)|(\.claude/agents/$roleId\.md)|(\.opencode/agents/$roleId\.md)|(\.agents/agents/$roleId/agent\.md))$"
if (@($rolePaths | Where-Object { $_ -notmatch $allowedRoleRoot }).Count -ne 0) {
  throw 'Manifest contains an unexpected role path'
}
$skillPaths = @('context-curation', 'failure-recovery', 'model-routing', 'task-routing',
  'task-spec', 'testing', 'token-efficiency', 'token-optimization') |
  ForEach-Object { ".agents/skills/$_" }
$copyPaths = @($rolePaths) + @($skillPaths)
foreach ($relative in $copyPaths) {
  $source = Join-Path $sourceRoot $relative
  $destination = Join-Path $consumerRoot $relative
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing source: $relative" }
  if (Test-Path -LiteralPath $destination) { throw "Consumer path already exists: $relative" }
}
foreach ($relative in $copyPaths) {
  $destination = Join-Path $consumerRoot $relative
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $destination -Recurse
}
```

This recipe is for the full reviewed manifest only. For `core` or a target subset, use its reviewed manifest and corresponding skill inventory. After copying, repeat the target-specific native smoke worksheet in the consumer before accepting that target.

Tests use disposable fixtures and synthetic manifests for output, ownership, adoption, recovery, and producer-free consumer copying. The distribution test covers both `core` (five roles/four skills) and `all` (15 roles/eight skills), reads copied files after removing the producer, and checks prompt portability and skill references. Node runs the test harness outside the consumer. This is deterministic packaging evidence, not native-tool smoke or a substitute for a reviewed committed manifest. A future adoption must review current hand-owned files one by one, resolve six canonical-versus-registered reasoning-effort differences (context-curator, environment-doctor, preview-manager, release-manager, researcher, verifier), establish each target's native evidence, and then create an approved migration record before any real-path write. The fifteenth role also needs its manual config-registration review and native-load gate before it can be used.
