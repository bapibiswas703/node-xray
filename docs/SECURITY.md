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
- `proxy-authorization`
- `www-authenticate`
- `proxy-authenticate`
- `cookie`
- `set-cookie`
- `cookie2`
- `x-api-key`
- `x-auth-token`
- `x-access-token`
- `x-refresh-token`
- `x-id-token`
- `x-session-id`
- `x-csrf-token`
- `x-xsrf-token`

The list is case-insensitive and merged with whatever you pass in `redactHeaders`. Redacted values are replaced with the literal string `'[REDACTED]'` (8 characters), regardless of original length. This avoids length-based side channels.

To disable the default deny list entirely (for example, in a fully trusted local debugging session), pass `redactHeaders: false`:

```ts
xray({ redactHeaders: false }); // captures every header verbatim
```

The same flag works for bodies (`redactBodyPaths: false`). Use both with care.

### Bodies — path-based

The redactor walks parsed JSON bodies and replaces values at configured paths. The default paths cover credentials (both naming conventions), payment data, and the most common PII fields:

| Path                             | Matches                             |
| -------------------------------- | ----------------------------------- |
| `password`                       | top-level `password`                |
| `passwd`                         | top-level `passwd`                  |
| `pwd`                            | top-level `pwd`                     |
| `token`                          | top-level `token`                   |
| `secret`                         | top-level `secret`                  |
| `apiKey`                         | top-level `apiKey`                  |
| `api_key`                        | top-level `api_key`                 |
| `accessToken` / `access_token`   | top-level access token              |
| `refreshToken` / `refresh_token` | top-level refresh token             |
| `idToken` / `id_token`           | top-level id token                  |
| `sessionId` / `session_id`       | top-level session id                |
| `authorization`                  | top-level `authorization`           |
| `privateKey` / `private_key`     | top-level private key               |
| `cvv`                            | top-level `cvv`                     |
| `pin`                            | top-level `pin`                     |
| `creditCard` / `credit_card`     | top-level credit card               |
| `cards[*].cvv`                   | `cvv` inside any `cards` array item |
| `cards[*].pin`                   | `pin` inside any `cards` array item |
| `ssn`                            | top-level `ssn`                     |
| `phone`                          | top-level `phone`                   |
| `*.password` … `*.phone`         | any of the above at any depth       |

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

### HTTP dashboard endpoint also requires auth

As of v1.0, the **HTTP** dashboard endpoint (`/node-xray/`, `/node-xray/app.js`, `/node-xray/styles.css`, `/node-xray/assets/*`) enforces the same `auth` block as the WebSocket upgrade. An unauthenticated request gets `401 Unauthorized` with a `WWW-Authenticate: Basic` header. Custom-verify exceptions are caught and translated to `500 Internal Server Error`; the original error is reported through the configured `onError` sink (default: `console.error`) and never becomes an unhandled rejection.

Password / token comparisons are **constant-time** to avoid timing side channels. The redactor's overall request capture is **not** side-channel safe — the timing of the redactor depends on the structure of the body.

## Content Security Policy

The dashboard sets the following response headers on every HTML, JS, and CSS response:

```
Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Notes on the directives:

- `'unsafe-inline'` is allowed for `style-src` because the dashboard uses inline `style="…"` attributes for progress bars and color hints. The stylesheet itself is loaded from the same origin (`__STYLES__`).
- `script-src 'self'` (no `'unsafe-inline'`) is strict. The dashboard ships one same-origin script (`__APP__`) and does not use `eval`, `new Function`, or `innerHTML` to render untrusted data.
- `form-action 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, and `X-Frame-Options: DENY` together prevent the dashboard from being framed, used as a form target, or as a `<base>` reference — the dashboard has none of those features.
- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin` isolate the dashboard from cross-origin windows and prevent other origins from embedding its resources.

If you need to lock this down further, put the dashboard behind a reverse proxy that strips headers and apply your own CSP there.

## Reporting a vulnerability

Please email `security@node-xray.dev` (PGP key on the website) or open a private security advisory on GitHub. Do not file a public issue for a vulnerability.

We aim to:

- Acknowledge within 2 business days.
- Triage within 5 business days.
- Ship a fix or a workaround within 30 days for high-severity issues.

## Audit log

Every config change you make to `xray()` is logged once at startup, including the option names that are set and the source (`env`, `default`, `user`). Values are never logged.
