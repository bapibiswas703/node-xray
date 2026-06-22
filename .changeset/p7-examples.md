---
---

# p7 — examples & docs polish

**Three runnable examples** under `examples/`, one per supported framework.
Each is ~50 lines of TypeScript, type-safe, and boots in a second with `pnpm dev`:

- `examples/express-basic`   — `xray()` middleware + error handler (port 3000)
- `examples/fastify-basic`   — `xrayPlugin` with `fastify-plugin` (port 3001)
- `examples/nestjs-basic`    — `NodeXrayModule.register` + global interceptor (port 3002)

Each example ships with its own `package.json`, `tsconfig.json`, `README.md`
(walkthrough, dev / production modes, what's demonstrated), and
graceful-shutdown signal handlers.

**Tooling**

- All examples are picked up by `pnpm -r typecheck` and `pnpm lint`.
- Each example has a `typecheck` script.
- The root `package.json` scripts were simplified to use `pnpm -r` (no
  manual glob filters); `pnpm typecheck` now runs on all 10 typed
  workspace projects (6 packages + 3 examples + 1 transitive).

**Docs polish**

- `README.md` (root) — adds an "Examples" section linking to each.
- `docs/QUICKSTART.md` — adds a link to the examples in "Next steps".
- `docs/FRAMEWORKS.md` — adds a "Runnable examples" section with the
  full tour pointer.
- `docs/CHANGELOG.md` — corrected the example names, added P6
  hardening summary (expanded redaction, HTTP auth gate, tightened
  CSP, `onError` hook, perf bench, soak test).
- `docs/ROADMAP.md` — corrected the examples line and added the
  perf bench + soak test to the v1.0 feature list.
- `docs/CONTRIBUTING.md` — updated the script table (removed
  non-existent `bench:check` / `bench:soak`), corrected the
  benchmark discipline section, updated the project layout to
  show `examples/` + `packages/bench/`.
- `docs/PERFORMANCE.md` — replaced the old `bench/` references
  with the actual `pnpm bench` command and the express soak test
  description.
- `examples/README.md` — new top-level index with a per-framework
  table, install / dev / production instructions, and a "what you
  should see" tour.

**Test count:** unchanged at 161. Typecheck now also covers the 3
examples (was previously only the 6 packages).
