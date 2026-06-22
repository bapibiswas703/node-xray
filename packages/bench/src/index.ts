/**
 * `node-xray` performance benchmark.
 *
 * A small Express server is built twice: once with `xray()` enabled
 * and once with `enabled: false` (a true no-op). The script then
 * hammers both with `N` requests and prints the throughput, mean
 * latency, and a rough memory delta. The output is plain text so
 * it can be diffed across runs.
 *
 * Run with `pnpm bench` (from the repo root) or
 * `node packages/bench/src/index.js` directly.
 */

import express from 'express';
import { xray } from '@node-xray/express';
import { performance } from 'node:perf_hooks';
import { createServer } from 'node:http';

const PORT = Number(process.env['PORT'] ?? 0);
const ROUNDS = Number(process.env['ROUNDS'] ?? 5_000);
const WARMUP = Number(process.env['WARMUP'] ?? 500);

const route = (req: express.Request, res: express.Response): void => {
  res.status(200).json({
    method: req.method,
    path: req.path,
    auth: req.headers['authorization'] ? '[REDACTED]' : '',
    // A modest body to exercise the redaction + capture path.
    body: req.body ?? null,
  });
};

interface Stats {
  label: string;
  totalMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rps: number;
}

async function bench(label: string, enabled: boolean): Promise<Stats> {
  const app = express();
  app.use(express.json());
  if (enabled) {
    app.use(xray({ maxRequests: 1000 }));
  }
  app.get('/api/ping', route);
  app.post('/api/echo', route);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  // Warmup.
  for (let i = 0; i < WARMUP; i++) {
    await fetch(`${baseUrl}/api/ping?w=${i}`).then((r) => r.text());
  }

  const samples: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < ROUNDS; i++) {
    const t = performance.now();
    if (i % 3 === 0) {
      const res = await fetch(`${baseUrl}/api/ping?i=${i}`, {
        headers: { authorization: 'Bearer sk_test' },
      });
      await res.text();
    } else {
      const res = await fetch(`${baseUrl}/api/echo?i=${i}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'p', username: 'u' }),
      });
      await res.text();
    }
    samples.push(performance.now() - t);
  }
  const totalMs = performance.now() - t0;
  await new Promise<void>((r) => server.close(() => r()));

  samples.sort((a, b) => a - b);
  const sum = samples.reduce((s, v) => s + v, 0);
  const pick = (q: number): number =>
    samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
  return {
    label,
    totalMs,
    meanMs: sum / samples.length,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    p99Ms: pick(0.99),
    rps: (ROUNDS / totalMs) * 1000,
  };
}

function fmt(n: number): string {
  return n.toFixed(2).padStart(8);
}

function print(s: Stats): void {
  console.log(
    `  ${s.label.padEnd(28)} rps=${fmt(s.rps)} mean=${fmt(s.meanMs)}ms p50=${fmt(s.p50Ms)}ms p95=${fmt(s.p95Ms)}ms p99=${fmt(s.p99Ms)}ms total=${fmt(s.totalMs)}ms`,
  );
}

async function main(): Promise<void> {
  console.log(`node-xray benchmark — ${ROUNDS} requests per run, ${WARMUP} warmup`);
  const off = await bench('xray disabled (control)', false);
  print(off);
  const on = await bench('xray enabled', true);
  print(on);
  const overheadPct = ((on.meanMs - off.meanMs) / off.meanMs) * 100;
  const rpsDropPct = ((off.rps - on.rps) / off.rps) * 100;
  console.log(
    `\n  mean-latency overhead: ${overheadPct >= 0 ? '+' : ''}${overheadPct.toFixed(1)}%   rps delta: -${rpsDropPct.toFixed(1)}%`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  throw err;
});
