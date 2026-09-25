# Task 5 documentation follow-up

- Updated the README and live preview guide to describe Signal Timeline as the latest ten stored signals, newest first. This matches `signals.slice(-10).reverse()` in `preview/index.html` and preserves the four-surface distinction.
- Verification: `node --test --experimental-test-isolation=none tests/preview-server.test.mjs tests/status-preview.test.mjs` passed (11/11); `git diff --check` passed.
- The first test attempt without `--experimental-test-isolation=none` could not start Node test workers in this sandbox (`spawn EPERM`); no test cases ran in that attempt.
