# Pure Harness project binding and staged runtime

The project diagnostic itself is read-only. It validates an explicit checkout, local binding, and project ID without creating a project runtime. See the [new-project start sequence](../README.md#시작하기) for the manifest and binding shapes and the safe order of commands.

```text
node scripts/project-diagnostic.mjs --checkout <absolute-checkout-path> --binding <absolute-local-binding-path> --project <project-id>
```

The command exits 0 when the binding and context are valid. Missing, stale, ambiguous, or invalid bindings exit nonzero with a bounded message naming the failing field. Binding contents and local path values are not printed. A checkout adapter may call `inspectProjectBinding({ checkoutRoot, bindingPath, projectId })` for the same read-only result; it must supply its own project ID. The engine does not default to a product project.

`checkRepository(root, { projectBinding: { checkoutRoot, bindingPath, projectId } })` adds the same check to a self-check report when the caller explicitly supplies the binding. `npm run self-check` without project flags checks the engine; supplying `--project <id> --checkout <path> --binding <path>` also checks the selected binding. In the staged Node engine, `init`, `status`, `watchdog`, `preview`, and `preview:live` require those three flags. `init` creates the selected runtime; `status` may create missing runtime files; `watchdog` writes warnings and events; `preview` writes a static snapshot; and `preview:live` initializes the runtime and serves a localhost dashboard. Run diagnostic before any of them. The diagnostic is not a migration, and passing it does not open the project cutover gate or verify native four-target distribution.
