---
'@node-xray/core': patch
'@node-xray/types': patch
'@node-xray/express': patch
'@node-xray/fastify': patch
'@node-xray/nestjs': patch
'@node-xray/dashboard': patch
---

Fix CI coverage job: add `@vitest/coverage-v8` as a per-package dev
dependency and add a `test:coverage` script that runs vitest with
`--coverage --passWithNoTests`. The previous `pnpm -r test -- --coverage`
invocation failed because the v8 coverage provider is a separate
package that was not declared anywhere.

This is a tooling-only fix. No runtime API changes.
