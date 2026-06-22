import { Module } from '@nestjs/common';
import { NodeXrayModule } from '@node-xray/nestjs';
import { AppController } from './app.controller.js';

const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

@Module({
  imports: [
    NodeXrayModule.register({
      path: '/_xray',
      maxRequests: 50,
      // Dashboard is unauthenticated in dev, Basic-auth in production.
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
  ],
  controllers: [AppController],
})
export class AppModule {}
