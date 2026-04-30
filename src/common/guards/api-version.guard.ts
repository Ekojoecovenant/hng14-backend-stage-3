/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class ApiVersionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const version = request.headers['x-api-version'];

    if (version != 1) {
      throw new BadRequestException({
        status: 'error',
        message: 'API version header required (X-API-Version: 1)',
      });
    }

    return true;
  }
}
