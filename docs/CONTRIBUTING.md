# Contributing

Thanks for considering a contribution. `node-xray` is a small monorepo with high standards for code quality, tests, and documentation. This document explains how to set up your environment, run the test suite, and ship a change.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be kind. Assume good faith. Disagree on substance, never on person.

## Project layout

```
node-xray/
├── packages/
│   ├── core/         # @node-xray/core
│   ├── express/      # @node-xray/express
│   ├── fastify/      # @node-xray/fastify
│   ├── nestjs/       # @node-xray/nestjs
│   ├── dashboard/    # @node-xray/dashboard
│   └── types/        # @node-xray/types
├── examples/         # express-demo, fastify-demo, nestjs-demo
├── bench/            # tinybench scripts and budget assertions
├── docs/             # user-facing documentation
└── .changeset/       # changesets (one per PR)
```

## Prerequisites

- Node.js **>= 18.17** (CI runs 18.17, 20, 22).
- pnpm **>= 9** (`npm install -g pnpm`).
- A POSIX-ish shell. The CI runs on Linux and Windows; commands here use the `pnpm` script names, which are shell-agnostic.

## First-time setup

```bash
git clone https://github.com/bapibiswas703/node-xray
cd node-xray
pnpm install
pnpm build
pnpm test
```

If `pnpm test` is green on your machine, you are ready.

## Scripts

The root `package.json` is a thin orchestrator. All commands are also runnable inside a package directory.

| Command              | What it does                                      |
| -------------------- | ------------------------------------------------- |
| `pnpm -r build`      | Build every package (tsup, ESM + CJS + dts)       |
| `pnpm -r typecheck`  | `tsc --noEmit` per package, strict mode           |
| `pnpm -r lint`       | `eslint` per package, flat config                 |
| `pnpm -r test`       | `vitest run` per package                          |
| `pnpm -r test:watch` | `vitest` in watch mode                            |
| `pnpm bench`         | Run all benchmark scripts                         |
| `pnpm bench:check`   | Same, with budget assertions (CI mode)            |
| `pnpm format`        | `prettier --write .`                              |
| `pnpm format:check`  | `prettier --check .`                              |
| `pnpm changeset`     | Open the changeset CLI to add a changeset         |
| `pnpm version`       | Apply changesets, bump versions, write CHANGELOGs |
| `pnpm release`       | Publish every changed package to npm              |

## Development workflow

1. **Create a branch** from `main`: `git switch -c fix/whatever`.
2. **Make the change.** Keep commits small and topical. The commit message must follow [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`. The `commitlint` hook will reject non-conforming commits.
3. **Add a changeset.** Every user-facing change needs a changeset. From the repo root:

   ```bash
   pnpm changeset
   ```

   Pick the affected packages, pick the semver bump (`patch`, `minor`, `major`), and write a one-line summary. The summary lands in the CHANGELOG. Do not put internal refactors in a changeset.

4. **Run the full check locally:**

   ```bash
   pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build
   ```

   The CI runs the same commands. If it fails locally, the PR will fail.

5. **Open a PR.** Fill in the template. The PR title must also follow Conventional Commits; the squash merge uses it as the commit message on `main`.

## Coding standards

### TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. These are non-negotiable.
- No `any` in the public surface. Use `unknown` and narrow.
- Public types live in `@node-xray/types`. The `core` package re-exports them. Adapters re-export from `core`. Do not re-define a public type in two places.
- Default to immutable shapes. Use `readonly` on public properties.
- Comments are for _why_, not _what_. If the code needs a comment to explain what it does, rewrite the code.

### Tests

- Every PR must include tests for the change. A PR that adds a feature without tests will be sent back.
- Tests use `vitest`. Prefer the `describe` / `it` style. Use `expect(...).toMatchObject(...)` for partial matches.
- The integration tests for adapters spin up a real framework and drive it with `supertest` / `fastify.inject` / `@nestjs/testing`. No mocking the framework.
- The WS protocol has a contract test in `tests/ws.spec.ts`. It replays a recorded snapshot through both client and server. If you change the protocol, update the test.

### Linting

- `eslint` flat config (`eslint.config.js`). The rules are a strict subset of `@typescript-eslint/recommended-type-checked` plus a few house rules.
- `prettier` is the only formatter. Do not bikeshed formatting in PRs.
- Imports are auto-sorted by `eslint-plugin-import` (configured for `type` style imports last).

## Architecture guardrails

These are the rules the maintainers will check before merging. They exist because the project is small enough to keep clean, and we want to keep it that way.

- **Core has zero runtime dependencies.** Adapters depend on core; nothing depends on adapters.
- **Adapters are thin.** Each adapter is "create context, hook lifecycle, mount dashboard". Anything else goes in core.
- **No silent fallbacks.** If a config option is wrong, throw. The startup error must be specific. Never silently downgrade to a default.
- **No allocations on the hot path** beyond the context object and the body clone. The body clone is necessary; the rest are not.
- **No monkey-patching of Node internals.** `fs`, `dns`, `crypto`, `net`, `http` are off-limits. The advisory thread-pool counter is exposed as a public API for adapters to call.
- **No raw `async_hooks`.** Use `AsyncLocalStorage`. The one exception is if you are writing a new ALS provider and have a benchmark proving ALS is the bottleneck. This has never happened.

## Benchmark discipline

- Any change to the hot path (the request-finish path, the store, the WS frame dispatcher) must be accompanied by a `bench/` update.
- The CI runs `pnpm bench:check`. A regression > 10% fails the build. If your change legitimately regresses, update the budget in `docs/PERFORMANCE.md` in the same PR, with justification.
- The soak test (nightly) is not in the PR gate, but if you touch memory-management code, run it locally:

  ```bash
  pnpm bench:soak -- --duration=10m
  ```

## Release process

We use [Changesets](https://github.com/changesets/changesets). The flow:

1. PRs land with `.changeset/<name>.md` files describing the change.
2. The "Version Packages" GitHub Action opens a PR that bumps versions and writes CHANGELOGs.
3. Merging that PR triggers the release workflow, which publishes every changed package to npm with `--provenance`.
4. A GitHub release is created with the CHANGELOG entries as notes.

The maintainers cut a minor release roughly every 4–6 weeks and patch releases as needed. There is no fixed schedule.

## Filing issues

- **Bug reports:** use the bug template. Include the Node version, the framework version, the package version, and a minimal repro.
- **Feature requests:** use the feature template. Describe the use case first; the API is a consequence.
- **Security issues:** see [`SECURITY.md`](./SECURITY.md). Do not file a public issue.

## License

By contributing, you agree that your contributions are licensed under the MIT License. See [`LICENSE`](./LICENSE).
