/* eslint-disable no-process-exit */
import express, { type Request, type Response, type NextFunction } from 'express';
import { xray } from '@node-xray/express';

const PORT = Number(process.env['PORT'] ?? 3000);
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

const app = express();
app.use(express.json());

// 1. Mount node-xray. In development the dashboard is unauthenticated
//    and body capture is on; in production we require Basic auth and
//    disable body capture (per the locked defaults).
const xrayHandle = xray({
  path: '/_xray',
  maxRequests: 50,
  ...(NODE_ENV === 'production'
    ? {
        auth: {
          type: 'basic' as const,
          user: 'admin',
          pass: process.env['XRAY_DASHBOARD_PASS'] ?? 'change-me',
        },
      }
    : {}),
});
app.use(xrayHandle);
app.use(xrayHandle.errorHandler);

// 2. A handful of routes exercising the inspector.
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'node-xray express example', env: NODE_ENV });
});

app.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Simulate a DB call so the inspector shows an async operation.
    await new Promise((r) => setTimeout(r, 25));
    res.json({ id: req.params['id'], name: `User ${req.params['id']}` });
  } catch (err) {
    next(err);
  }
});

app.post('/login', (req: Request, res: Response) => {
  // The password field will be redacted in the inspector by default.
  const { username } = req.body ?? {};
  res.json({ token: 'demo-jwt', username });
});

app.get('/boom', (_req: Request, _res: Response, next: NextFunction) => {
  next(new Error('intentional explosion for the inspector'));
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[example] express listening on http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[example] node-xray dashboard: http://127.0.0.1:${PORT}/_xray/`);
  // eslint-disable-next-line no-console
  console.log(`[example] try: curl http://127.0.0.1:${PORT}/users/42`);
});

const shutdown = (signal: string): void => {
  // eslint-disable-next-line no-console
  console.log(`[example] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
