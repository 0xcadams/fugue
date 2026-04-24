---
name: release
description: Prepare and execute fugue releases using the repo's GitHub release workflow, npm trusted publishing, and version-tag rules.
---

## What I do

- Guide release prep for this repo's npm package and GitHub release flow.
- Verify the package version in `fugue/package.json` matches the intended tag `v<version>`.
- Follow the repo's release workflow in `.github/workflows/release.yml`.
- Use the repo's standard validation steps before release when changes affect package behavior:
  - `bun run test`
  - `bunx prettier . --check`
  - `bun run test:types`
  - `bun run build`
  - `npm pack --dry-run`
- Create or suggest the correct `gh release create` command for a new version.
- Warn if the requested release already exists or if the tag/version do not match.

## When to use me

Use this skill when preparing, validating, or kicking off a new `fugue` release.

## Repo-specific release rules

- Releases are published from GitHub Releases, not from a direct local `npm publish` or `bun publish`.
- The release tag must exactly match the package version as `v<version>`.
- The package version lives in `fugue/package.json`.
- The publishing workflow is `.github/workflows/release.yml`.
- The workflow publishes the `fugue/` workspace after verification passes.
- npm trusted publishing must be configured for workflow filename `release.yml`.
- Do not create a release for an already-published tag unless the user explicitly wants to rerun the workflow.

## Default workflow

1. Check the current branch and workspace state.
2. Determine the intended release branch from the user's request, or use the current branch if that is clearly where the release should happen.
3. Confirm the target branch contains `.github/workflows/release.yml` and the intended release changes.
4. Read `fugue/package.json` and determine the target tag `v<version>`.
5. Check whether that git tag and GitHub Release already exist.
6. If no new version exists yet, ask for or prepare the version bump before release.
7. Run the repo's verification commands when appropriate.
8. Create the GitHub Release with `gh release create v<version> --target <branch>`.
9. Report the release URL and any follow-up verification status.

## Ask when blocked

Ask one focused question if:

- the user wants a release but no new version has been chosen,
- the intended release branch is unclear,
- the target branch does not contain `.github/workflows/release.yml`,
- the worktree has unrelated changes that could affect release prep,
- or the requested action would rerun an existing release instead of creating a new one.
