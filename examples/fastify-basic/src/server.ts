/* eslint-disable no-process-exit */
import Fastify, { type FastifyInstance } from 'fastify';
import { xrayPlugin } from '@node-xray/fastify';

const PORT = Number(process.env['PORT'] ?? 3001);
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const HOST = '127.0.0.1';

const app: FastifyInstance = Fastify({
  logger: NODE_ENV === 'production' ? { level: 'info' } : false,
});

// The plugin auto-mounts the dashboard using @node-xray/dashboard's
// internal `getAssetsDir()`. In production we pass `auth`; in
// development the dashboard is unauthenticated.
await app.register(
  xrayPlugin({
    path: '/_xray',
    maxRequests: 50,
    ...(NODE_ENV === 'production'
      ? {
          auth: {
            type: 'basic',
            user: 'admin',
            pass: process.env['XRAY_DASHBOARD_PASS'] ?? 'change-me',
          },
        }
      : {}),
  }),
);

app.get('/', async () => ({ message: 'node-xray fastify example', env: NODE_ENV }));

app.get<{ Params: { id: string } }>('/users/:id', async (req) => {
  await new Promise((r) => setTimeout(r, 25));
  return { id: req.params.id, name: `User ${req.params.id}` };
});

app.post<{ Body: { username?: string; password?: string } }>('/login', async (req) => {
  return { token: 'demo-jwt', username: req.body?.username };
});

app.get('/boom', async () => {
  throw new Error('intentional explosion for the inspector');
});

await app.listen({ port: PORT, host: HOST });
// eslint-disable-next-line no-console
console.log(`[example] fastify listening on http://${HOST}:${PORT}`);
// eslint-disable-next-line no-console
console.log(`[example] node-xray dashboard: http://${HOST}:${PORT}/_xray/`);
// eslint-disable-next-line no-console
console.log(`[example] try: curl http://${HOST}:${PORT}/users/42`);

const shutdown = async (signal: string): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(`[example] received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
