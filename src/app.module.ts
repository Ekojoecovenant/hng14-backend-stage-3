import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { GithubStrategy } from './auth/strategies/github.strategy';
import { ProfileModule } from './profile/profile.module';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ProfileModule,
  ],
  providers: [PrismaService, GithubStrategy],
  exports: [PrismaService],
})
export class AppModule {}
