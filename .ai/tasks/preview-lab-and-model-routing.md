# Preview Lab and model routing

## Goal

Expose read-only Task Specs and registered UI artifacts in Preview Lab, and document the native GPT-6 to GPT-5.6 spawn fallback procedure.

## Requirements

- Discover only `.ai/tasks/*.md` and serve it through a read-only live endpoint.
- Include the same Task Specs in the one-shot static preview.
- Embed only local/same-origin artifacts with a sandbox; leave external artifacts as links.
- Preserve configured GPT-6 role defaults and use no unsupported fallback config keys.

## Out of scope

Automatic spawn-error interception, model probing, task editing, artifact storage, and workflow changes.

## Verification

Run the repository test suite, self-check, CLI commands, and live endpoint smoke tests.
