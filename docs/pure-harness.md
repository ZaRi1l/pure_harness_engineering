# Pure Harness project binding diagnostics

The project binding gate is diagnostic-only during staging. It validates an explicit checkout, local binding, and project ID without creating a project runtime or changing the existing status, hook, GOAL, or preview commands.

```text
node scripts/project-diagnostic.mjs --checkout <absolute-checkout-path> --binding <absolute-local-binding-path> --project <project-id>
```

The command exits 0 when the binding and context are valid. Missing, stale, ambiguous, or invalid bindings exit nonzero with a bounded message naming the failing field. Binding contents and local path values are not printed. A checkout adapter may call `inspectProjectBinding({ checkoutRoot, bindingPath, projectId })` for the same read-only result; it must supply its own project ID. The engine does not default to a product project.

`checkRepository(root, { projectBinding: { checkoutRoot, bindingPath, projectId } })` adds the same check to a self-check report when the caller explicitly supplies the binding. Ordinary `npm run self-check` and legacy commands remain on their existing paths until an approved cutover. This command is not a migration or runtime initialization step.
