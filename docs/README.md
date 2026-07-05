# `node-xray` documentation

This directory is the user-facing documentation for `node-xray`. Start with the [Quick start](./QUICKSTART.md) and the [README](../README.md) at the repo root.

## Index

| Document                            | Audience                       | Read when…                                                                   |
| ----------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| [Quick start](./QUICKSTART.md)      | Everyone                       | You want to install and run the dashboard in 60 seconds.                     |
| [Architecture](./ARCHITECTURE.md)   | Contributors, advanced users   | You want to understand the internals or write a custom adapter.              |
| [Configuration](./CONFIGURATION.md) | Everyone                       | You are tuning options or reading the option matrix.                         |
| [API reference](./API.md)           | Library users                  | You are calling `@node-xray/core` directly (custom sinks, decorators).       |
| [Framework notes](./FRAMEWORKS.md)  | Framework users                | You are on Express, Fastify, or NestJS and need framework-specific guidance. |
| [Dashboard](./DASHBOARD.md)         | Dashboard users                | You are looking at the UI and want a tour.                                   |
| [Events](./EVENTS.md)               | Dashboard authors, integrators | You are building a custom sink or a non-default dashboard.                   |
| [Security](./SECURITY.md)           | Security reviewers, ops        | You are evaluating the package for use in non-dev environments.              |
| [Performance](./PERFORMANCE.md)     | Performance engineers          | You are chasing a regression or tuning for a hot path.                       |
| [Roadmap](./ROADMAP.md)             | Everyone                       | You want to know what is in v1, what is not, and what is next.               |
| [Contributing](./CONTRIBUTING.md)   | Contributors                   | You are about to open a PR.                                                  |
| [Changelog](./CHANGELOG.md)         | Everyone                       | You want to know what changed between versions.                              |

## Order of reading

If you are new to the package:

1. [Quick start](./QUICKSTART.md) — install, run, open the dashboard.
2. [Configuration](./CONFIGURATION.md) — skim the option matrix; read the sections that look relevant.
3. [Framework notes](./FRAMEWORKS.md) — the chapter for your framework.
4. [Dashboard](./DASHBOARD.md) — the UI tour.

If you are evaluating the package for production use, also read:

- [Security](./SECURITY.md) — threat model, redaction, auth.
- [Performance](./PERFORMANCE.md) — budgets and the benchmark suite.

If you are contributing:

- [Architecture](./ARCHITECTURE.md) — first.
- [Contributing](./CONTRIBUTING.md) — second.
- [Events](./EVENTS.md) — if your change touches the wire protocol.

## Other files in this directory

- `node_xray_dashboard_v4_1.html` — the frozen UI mockup that the v1 dashboard is built from.
