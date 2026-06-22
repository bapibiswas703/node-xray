import { Controller, Get, Param, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import type { XRayService } from '@node-xray/nestjs';

class LoginDto {
  username!: string;
  password!: string;
}

@Controller()
export class AppController {
  constructor(private readonly xray: XRayService) {}

  @Get()
  root(): { message: string } {
    return { message: 'node-xray nestjs example' };
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string): Promise<{ id: string; name: string }> {
    // Simulate a DB call so the inspector shows an async operation.
    await new Promise((r) => setTimeout(r, 25));
    return { id, name: `User ${id}` };
  }

  @Post('login')
  login(@Body() body: LoginDto): { token: string; username: string | undefined } {
    // The password field is redacted in the inspector by default.
    return { token: 'demo-jwt', username: body.username };
  }

  @Get('boom')
  boom(): never {
    throw new HttpException(
      'intentional explosion for the inspector',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
