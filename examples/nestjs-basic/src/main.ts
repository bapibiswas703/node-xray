/* eslint-disable no-process-exit */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const PORT = Number(process.env['PORT'] ?? 3002);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true });
  await app.listen(PORT, '127.0.0.1');
  // eslint-disable-next-line no-console
  console.log(`[example] nestjs listening on http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[example] node-xray dashboard: http://127.0.0.1:${PORT}/_xray/`);
  // eslint-disable-next-line no-console
  console.log(`[example] try: curl http://127.0.0.1:${PORT}/users/42`);

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[example] received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[example] failed to start', err);
  process.exit(1);
});
