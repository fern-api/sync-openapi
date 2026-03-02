# Changelog

All notable changes to this project will be documented in this file.

## v4

### Added

- **PR deduplication for `update_from_source` mode.** When `auto_merge` is `false`, the action now checks for an existing open PR on the branch before creating a new one. Subsequent runs push new commits to the existing PR instead of creating duplicates.
- **Push fallback with rebase retry.** If a regular push is rejected (e.g., branch has diverged), the action attempts `git pull --rebase` and retries. If rebase fails due to merge conflicts, a detailed comment is left on the PR with the full git error output and resolution steps, and the action fails.
- **Default branch name.** The `branch` input now defaults to `fern/sync-openapi`. Customers can still override it.
- **Release workflow.** Publishing a GitHub Release (e.g., `v4.1.0`) automatically force-updates the major (`v4`) and minor (`v4.1`) version tags so consumers on `@v4` or `@v4.1` stay up to date.
- **CI workflow.** Runs lint (Biome), tests (Vitest), build, and `dist/` verification on every PR and push to main.
- **E2E test script** (`e2e/run-e2e.ts`) that validates happy path (PR reuse) and conflict path (error comment) against a real test repo.
- **Biome.js** for linting and formatting, replacing ESLint. Configured with 4-space indentation, double quotes, recommended lint rules, and import sorting.
- **12 unit tests** covering PR creation, PR reuse, no-op on no changes, push without `--force`, rebase retry, PR comment on conflict, error path separation, rebase abort error handling, `setFailed` on all failure paths, and auto-merge bypass.

### Changed

- **Node runtime bumped to `node20`** (from deprecated `node16`) in `action.yml`.
- **Vitest 4** replaces Jest as the test framework.
- **CI actions updated** to `actions/checkout@v6` and `actions/setup-node@v6` with Node 20.
- **Non-null assertions replaced** with runtime guards in `syncChanges` for safer error handling.
- **Caught errors are now logged** via `core.debug()` instead of being silently ignored, aiding debugging when `ACTIONS_STEP_DEBUG` is enabled.
- **`--force` removed from `git push`** in the `updateFromSourceSpec` path so commits accumulate naturally.

### Fixed

- **Duplicate PRs.** The `updateFromSourceSpec` function previously created a new PR on every run that detected changes, even if an open PR already existed for the same branch.
- **Error messages in PR comments.** Multi-line git error output now uses fenced code blocks instead of inline code spans, fixing broken Markdown rendering on GitHub.
- **Error path separation.** `pushWithFallback` now correctly distinguishes between "rebase failed" (merge conflicts) and "rebase succeeded but push failed" (push rejection), providing accurate diagnostic labels in PR comments.

## v3

### Added

- Removed `addTimestamp` from branch names.
- Small cleanup and reformatting.

### Changed

- Updated `glob` and `js-yaml` dependencies.

## v2.1

### Fixed

- Fixed branch logic and `--force` tag handling.
- Removed date from branch names.

## v2

### Added

- Option to run `fern api upgrade`.
- Branch name formatting.
- Upstream remote support.

### Changed

- Updated actions and token handling.

## v1

### Added

- Directory and file mapping with `from`/`to` fields.
- Glob-based `exclude` patterns via `minimatch`.
- Better error messages for fetch failures.

## v0

- Initial release with basic OpenAPI spec syncing between repositories.
