import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get()
  health() {
    return {
      status: 'success',
      message: 'Server is healthy',
    };
  }
}
