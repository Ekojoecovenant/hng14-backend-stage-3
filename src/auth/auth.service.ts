/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AuthResponse,
  GithubProfile,
  JwtPayload,
} from './interfaces/user.interface';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateOAuthUser(profile: GithubProfile) {
    let user = await this.prisma.user.findUnique({
      where: { github_id: profile.github_id },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          github_id: profile.github_id,
          username: profile.username,
          email: profile.email,
          avatar_url: profile.avatar_url,
          role: 'ANALYST',
        },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      });
    }

    return user;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async login(user: any): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      github_id: user.github_id,
      role: user.role,
    };

    const access_token = this.jwtService.sign(payload);

    return {
      status: 'success',
      access_token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  async refreshToken(oldRefreshToken: string) {
    const user = await this.prisma.user.findFirst({
      where: { refreshToken: oldRefreshToken },
    });

    if (!user) throw new UnauthorizedException('Invalid refresh token');

    const payload: JwtPayload = this.jwtService.verify(oldRefreshToken);

    const newAccessToken = this.jwtService.sign({
      ...payload,
    });

    const newRefreshToken = this.jwtService.sign(
      { ...payload },
      { expiresIn: '5m' },
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
    });

    return {
      status: 'success',
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    };
  }

  async logout(refreshToken: string) {
    await this.prisma.user.updateMany({
      where: { refreshToken },
      data: { refreshToken: null },
    });

    return {
      status: 'success',
      message: 'Logged out successfully',
    };
  }

  async findOrCreateTestAdmin() {
    let user = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          github_id: 'test_admin_001',
          username: 'test_admin',
          email: 'admin@test.com',
          role: 'ADMIN',
        },
      });
    }

    return user;
  }

  async findOrCreateTestAnalyst() {
    let user = await this.prisma.user.findFirst({
      where: { role: 'ANALYST' },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          github_id: 'test_analyst_001',
          username: 'test_analyst',
          email: 'analyst@test.com',
          role: 'ANALYST',
        },
      });
    }

    return user;
  }
}
