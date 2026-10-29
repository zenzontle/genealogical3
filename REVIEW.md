# Review guide

Guidance for AI and human reviewers of pull requests in this repository. It decides what is worth flagging; it does not change the output format of any review tool.

## What counts as a finding

Flag a change only when it can cause one of these:

- **Data loss or corruption.** Anything that can drop, overwrite, or silently change a user's tree, people, relationships, portraits, or canvas layout, in browser storage or in Google Drive.
- **Wrong Drive behavior.** Deleting, overwriting, or uploading the wrong file; skipping ownership, revision, or backup-identity checks; touching files outside the app's `genealogical3` folder; widening the `drive.file` scope; leaking tokens or client secrets.
- **Broken sync or conflict handling.** Lost local edits when a Drive save fails, conflicts that are not paused for review, autosaves that are not drained before deletion, or retries that repeat completed destructive steps.
- **Incorrect tree logic.** Wrong kinship, relationship edges, layout, or validation that accepts invalid documents or rejects valid ones.
- **Regressions in existing behavior**, including accessibility (keyboard access, focus return, accessible labels) and toast behavior.
- **Security issues** in `server/` and `api/` (OAuth handling, redirects, input validation) or in how the browser handles imported JSON and images.
- **Missing tests** for a behavior change in `src/lib`, `server/`, or Drive deletion and sync flows.

For bug fixes, check that the change addresses the root cause, and that other instances of the same bug class are fixed too.

## What not to flag

- Formatting and lint issues. Prettier and ESLint run in CI.
- Type errors, failing tests, and build failures. CI runs `tsc -b`, `pnpm test`, and `vite build`.
- Naming, style, or refactoring preferences that don't affect behavior.
- Problems that already existed before the PR, unless the PR makes them worse.
- Issues already raised in an earlier review round of the same PR.

## Ignored paths

- `pnpm-lock.yaml`
- `dist/`, `coverage/`, `.perf/`, `.codegraph/`
- Generated fixtures written by `scripts/generate-fixtures.mjs`

## Paths that need extra care

These changes always need a human reviewer, even if AI review passes:

- `.github/workflows/` (CI and merge gates)
- `server/`, `api/` (OAuth and Drive auth)
- `src/lib/drive*.ts`, `src/lib/storage.ts` (persistence and Drive deletion)

## Every finding

- Cite the file and line.
- Explain the concrete failure: what input or state leads to what wrong result.
