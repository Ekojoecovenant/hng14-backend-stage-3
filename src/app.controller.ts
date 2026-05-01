import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return {
      status: 'success',
      message: 'Server is healthy',
    };
  }
}
