import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAssetsDir, getAssetPath, DASHBOARD_VERSION, PATH_INJECTOR_SCRIPT } from './index.js';

describe('@node-xray/dashboard', () => {
  describe('exports', () => {
    it('exposes the dashboard version', () => {
      expect(DASHBOARD_VERSION).toBe('1.0.0');
    });

    it('exposes a path-injector script that sets the dashboard path on the global', () => {
      expect(typeof PATH_INJECTOR_SCRIPT).toBe('string');
      expect(PATH_INJECTOR_SCRIPT).toContain('__PATH__');
      expect(PATH_INJECTOR_SCRIPT).toContain('window.__XRAY_DASHBOARD_PATH__');
    });

    it('getAssetsDir returns an absolute path that exists', () => {
      const dir = getAssetsDir();
      expect(resolve(dir)).toBe(dir);
      expect(existsSync(dir)).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
    });

    it('getAssetPath joins name onto the assets dir', () => {
      const dir = getAssetsDir();
      expect(getAssetPath('index.html')).toBe(resolve(dir, 'index.html'));
      expect(getAssetPath('app.js')).toBe(resolve(dir, 'app.js'));
      expect(getAssetPath('styles.css')).toBe(resolve(dir, 'styles.css'));
    });
  });

  describe('assets', () => {
    it('ships index.html, app.js, and styles.css', () => {
      for (const name of ['index.html', 'app.js', 'styles.css']) {
        const path = getAssetPath(name);
        expect(existsSync(path), `${name} should exist at ${path}`).toBe(true);
        expect(statSync(path).isFile()).toBe(true);
        expect(statSync(path).size).toBeGreaterThan(0);
      }
    });

    it('index.html is a valid HTML5 document', () => {
      const html = readFileSync(getAssetPath('index.html'), 'utf-8');
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toMatch(/<html [^>]*lang=/i);
      expect(html).toMatch(/<head>/i);
      expect(html).toMatch(/<body>/i);
      expect(html).toMatch(/<\/html>/i);
      // The HTML must reference the modular assets via the
      // `__STYLES__` / `__APP__` tokens that the core replaces at
      // serve time.
      expect(html).toContain('__STYLES__');
      expect(html).toContain('__APP__');
      // Accessibility: the document should expose an `aria-label` on
      // the root container.
      expect(html).toMatch(/aria-label="node-xray dashboard"/i);
    });

    it('app.js is a syntactically valid IIFE', () => {
      const js = readFileSync(getAssetPath('app.js'), 'utf-8');
      // The file may start with a header comment; the IIFE itself
      // must appear somewhere in the body.
      expect(js).toMatch(/\(function \(\) \{[\s\S]*'use strict';/);
      expect(js).toMatch(/\}\)\(\);\s*$/m);
      // The client must open a WebSocket to <path>/ws.
      expect(js).toContain('WebSocket');
      expect(js).toContain('/ws');
      // The client must handle every wire frame the server sends.
      for (const t of [
        "'hello'",
        "'snapshot'",
        "'request:new'",
        "'request:update'",
        "'request:done'",
        "'loop'",
        "'error'",
      ]) {
        expect(js, `app.js must handle frame t=${t}`).toContain(t);
      }
    });

    it('styles.css defines the root `.xr` class and the dark theme', () => {
      const css = readFileSync(getAssetPath('styles.css'), 'utf-8');
      expect(css).toContain('.xr');
      expect(css).toContain('#0d0f1a');
      expect(css).toContain('#7c3aed');
      expect(css).toContain('JetBrains Mono');
    });
  });

  describe('PATH_INJECTOR_SCRIPT', () => {
    it('can be substituted with a path and produce valid JS', () => {
      const injected = PATH_INJECTOR_SCRIPT.replace('__PATH__', '/node-xray');
      // The result must be a single assignment statement.
      expect(injected).toBe("window.__XRAY_DASHBOARD_PATH__ = '/node-xray';");
    });
  });
});
