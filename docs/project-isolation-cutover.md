# Project-isolation cutover gate (staging)

This is a read-only decision gate, not a migration or a real cutover command.
Run it only against a disposable installation and an independently staged
project checkout. A live checkout, original engine source, or real local
installation is not a rehearsal target.

`checkCutover(options)` requires one explicit project binding, a passing
validation report, fresh-session role/skill and five-hook evidence, a verified
`status`/`preview`/`claim`/`release-claim` command list, and quiescence counts
of zero legacy sessions, legacy writers, and active claims. Caller-supplied
arrays and counts do **not** prove those conditions: this staging gate always
returns `ok: false` until a trusted native/runtime evidence reader is built
and reviewed. Supply a prior
inventory from `inventoryRuntime(legacyRuntimeRoot)`; the gate re-reads file
names, byte sizes, and SHA-256 hashes and fails if anything changed. The gate
neither creates runtime data nor switches a pointer. Missing evidence fails
closed, even when all deterministic tests pass.

Operator sequence:

1. Inventory the old disposable runtime and record its schema, file names,
   sizes, and hashes. Record the active adapter pointer's exact bytes.
2. End disposable old sessions and writers. Confirm no active claims; do not
   run old and new runtimes as synchronized writers.
3. Validate the binding and selected checkout identity. Run the test suite,
   self-check, source-purity test, and a fresh session's role, skill, and five
   lifecycle-hook checks. Verify `status`, Preview, claim/release, dashboard
   selection, product route if registered, and blocked private/runtime URLs.
4. Call `checkCutover` with those actual reports. Its current fail-closed
   result blocks any operator cutover. A disposable test may deliberately
   switch an isolated fixture pointer and restore it to rehearse rollback;
   that is not permission to switch this staged checkout's pointer.
5. Recheck the old runtime inventory and the new selected runtime. If a
   post-switch check fails, stop new sessions, atomically restore the saved
   pointer bytes, and stop. Do not fall back automatically or copy/migrate
   old state. Keep both old and new state intact for investigation.

Fresh-session discovery, native hook dispatch, and model entitlement are
external observations, not inferred from repository files or synthetic tests.
Their absence blocks any selective transfer. A later real cutover and any
state migration each require separate approval and a reviewed plan.
