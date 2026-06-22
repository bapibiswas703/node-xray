# Security

> **TL;DR.** `node-xray` is a development tool. The dashboard exposes request and response bodies. **Do not enable it in production without reading this document.**

This document covers the threat model, what is redacted by default, what is not, and how to run the dashboard safely in non-dev environments.

## Threat model

`node-xray` is designed for one specific scenario: a developer running their app on their laptop. The dashboard is on the same machine, on a port the developer chose, with no auth.

The threats we explicitly defend against:

- **Accidental body capture of credentials.** Headers and bodies are redacted by default. The redactor runs before anything is stored or transmitted.
- **Memory growth from a malicious body.** All sizes are capped. A 10 MB body becomes a 100 KB `{ __truncated: true, originalSize: 10_485_760 }`.
- **Stack trace leaking internal file paths.** Stack frames are sanitized: `node_modules` is collapsed, file paths are shortened to `<repo>/src/...`.
- **Long-running production exposure.** The package refuses to mount in `NODE_ENV=production` without an `auth` block. There is no opt-out from this.

The threats we explicitly do **not** defend against:

- **A determined attacker on the same network.** If you bind the dashboard to a public interface without `auth`, you are on your own. The package will warn at startup.
- **Side-channel timing of password checks.** The redactor runs in constant time per field, but the overall request capture is not side-channel safe.
- **The dashboard's own JavaScript being XSS'd.** The dashboard renders bodies as text, not HTML. We do not `eval` anything from the wire. If you find an XSS, that's a bug — file it.

## What is redacted

### Headers — default-deny

By default, the following headers are redacted from both request and response snapshots:

- `authorization`
- `cookie`
- `set-cookie`
- `x-api-key`
- `proxy-authorization`

The list is case-insensitive and merged with whatever you pass in `redactHeaders`. Redacted values are replaced with the literal string `'[REDACTED]'` (8 characters), regardless of original length. This avoids length-based side channels.

### Bodies — path-based

The redactor walks parsed JSON bodies and replaces values at configured paths. The default paths:

| Path           | Matches                             |
| -------------- | ----------------------------------- |
| `password`     | top-level `password`                |
| `token`        | top-level `token`                   |
| `secret`       | top-level `secret`                  |
| `apiKey`       | top-level `apiKey`                  |
| `*.password`   | any nested `password`               |
| `*.token`      | any nested `token`                  |
| `*.secret`     | any nested `secret`                 |
| `cards[*].cvv` | `cvv` inside any `cards` array item |

Replacement value: the literal string `'[REDACTED]'`.

The walker:

- Is depth-limited to 16. Deeper objects are replaced with `'[DEPTH]'`.
- Detects cycles. A cyclic subtree is replaced with `'[CYCLE]'`.
- Operates on a structured clone. The original `req.body` is not mutated.

### Bodies — size cap

Any body that, after JSON-stringification, exceeds `maxBodySize` is replaced with:

```json
{ "__truncated": true, "originalSize": 248213 }
```

The cap is enforced before redaction, so a 10 MB body with one small redacted field still costs 100 KB.

### URL query strings

Query strings are not redacted by default. The path is stored as-is. If you have secrets in your URLs (you should not), add them to `redactHeaders` of the upstream service and re-route, or open an issue.

## Production posture

### Default behavior

If `NODE_ENV === 'production'`:

1. `enabled` defaults to `false`. The adapter is a no-op.
2. If you explicitly set `enabled: true`, the adapter mounts the dashboard **only if** `auth` is also set. Otherwise it throws at startup.
3. The startup error is `XRayConfigError` with the message:

   > `auth is required when NODE_ENV=production. See https://node-xray.dev/security.`

This is intentional. There is no warning-and-continue mode in v1.

### Recommended production setup

```ts
xray({
  enabled: true,
  auth: { type: 'bearer', token: process.env.XRAY_TOKEN! },
  captureRequestBody: false, // turn this on only if you really need it
  captureResponseBody: false, // turn this on only if you really need it
  stack: { enabled: false }, // do not capture stacks in prod
  maxRequests: 50, // tighter buffer
});
```

Set `XRAY_TOKEN` to a long random string. Distribute it only to the people who need dashboard access. Rotate it like any other secret.

### Multi-replica deployments

Every replica has its own dashboard. There is no central aggregation in v1. If you have 10 replicas, an attacker who gets the token sees only the requests handled by the replica they happen to hit. This is good for blast radius, bad for completeness. See [`ROADMAP.md`](./ROADMAP.md).

## Network exposure

### The dashboard binds to your app's interface

If your app listens on `0.0.0.0:3000`, the dashboard is reachable from any network that can reach `:3000`. The startup logs include a warning when this happens:

```
[node-xray] WARNING: dashboard is bound to 0.0.0.0:3000.
[node-xray] This is fine in development. In production, ensure
[node-xray] NODE_ENV is set and an auth block is configured.
```

### WebSocket origin checking

The WebSocket upgrade checks the `Origin` header against an allowlist. The default allowlist is:

- The same host as the HTTP request (including `localhost` variations).
- `null` (for `file://` and some test runners).

In dev, anything goes. In production with `auth`, the origin must match the allowlist **and** the auth check must pass. Either failure closes the upgrade with code `1008`.

## Content Security Policy

The dashboard sets the following response headers:

```
Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The `'unsafe-inline'` for styles is required by the v4.1 design (inline `<style>` blocks for theme variables). This is tracked as a known issue on the roadmap. Scripts are strictly same-origin.

If you need to lock this down further, put the dashboard behind a CDN that strips headers and apply your own CSP there.

## Reporting a vulnerability

Please email `security@node-xray.dev` (PGP key on the website) or open a private security advisory on GitHub. Do not file a public issue for a vulnerability.

We aim to:

- Acknowledge within 2 business days.
- Triage within 5 business days.
- Ship a fix or a workaround within 30 days for high-severity issues.

## Audit log

Every config change you make to `xray()` is logged once at startup, including the option names that are set and the source (`env`, `default`, `user`). Values are never logged.
