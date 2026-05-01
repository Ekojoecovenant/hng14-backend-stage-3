import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { ProfileModule } from './profile/profile.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'auth', ttl: 60000, limit: 10 },
      { name: 'default', ttl: 60000, limit: 60 },
    ]),
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ProfileModule,
  ],
  providers: [PrismaService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [PrismaService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
