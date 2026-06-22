# @node-xray/nestjs

NestJS module adapter for `node-xray`.

> Implementation lands in P4. The P0 stub exposes the module shape so the build chain is testable.

```ts
import { Module } from '@nestjs/common';
import { NodeXrayModule } from '@node-xray/nestjs';

@Module({ imports: [NodeXrayModule.register()] })
class AppModule {}
```
