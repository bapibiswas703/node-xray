import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packaging regression tests (audit finding 2).
 *
 * tsup used to inline @node-xray/core into every adapter dist (pnpm
 * workspace symlinks defeat `skipNodeModulesBundle`), which gave each
 * adapter a private copy of core's module state (ALS instance, event
 * bus) and a bare `require('ws')` the adapters never declare — the
 * published fastify/nestjs packages crashed at require time under
 * pnpm's strict layout.
 *
 * These tests parse each built `dist/index.cjs` and assert that every
 * bare require specifier is either a Node builtin or declared in that
 * package's `dependencies` / `peerDependencies`. They skip when the
 * dist has not been built (CI builds before testing).
 */

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, '..', '..');
const req = createRequire(import.meta.url);

const PACKAGES = ['types', 'core', 'dashboard', 'express', 'fastify', 'nestjs'] as const;

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function bareSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/\brequire\((?:"([^"\\]+)"|'([^'\\]+)')\)/g)) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    // Reduce deep imports to the package name (@scope/name or name).
    const parts = spec.split('/');
    out.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec));
  }
  return [...out];
}

describe('dist packaging', () => {
  for (const pkg of PACKAGES) {
    const distFile = resolve(packagesDir, pkg, 'dist', 'index.cjs');
    const built = existsSync(distFile);

    it.skipIf(!built)(`@node-xray/${pkg} dist requires only declared dependencies`, () => {
      const manifest = req(resolve(packagesDir, pkg, 'package.json')) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      const source = readFileSync(distFile, 'utf-8');
      const undeclared = bareSpecifiers(source).filter(
        (spec) => !builtins.has(spec) && !declared.has(spec),
      );
      expect(undeclared).toEqual([]);
    });

    it.skipIf(!built)(`@node-xray/${pkg} dist does not inline a private copy of core`, () => {
      const source = readFileSync(distFile, 'utf-8');
      if (pkg === 'core') {
        // Core itself owns the hub; it must reference ws.
        expect(source).toMatch(/require\((?:"ws"|'ws')\)/);
        return;
      }
      // Anyone else referencing ws means core got bundled in again.
      expect(source).not.toMatch(/require\((?:"ws"|'ws')\)/);
      // The ALS singleton must come from the real core package.
      if (pkg === 'express' || pkg === 'fastify' || pkg === 'nestjs') {
        expect(source).toMatch(/require\((?:"@node-xray\/core"|'@node-xray\/core')\)/);
        expect(source).not.toContain('AsyncLocalStorage');
      }
    });
  }
});
