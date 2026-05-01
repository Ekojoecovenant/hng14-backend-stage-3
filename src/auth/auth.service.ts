/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AuthResponse,
  GithubProfile,
  JwtPayload,
} from './interfaces/user.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
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
      // } else {
      //   user = await this.prisma.user.update({
      //     where: { id: user.id },
      //     data: { last_login_at: new Date() },
      //   });
    }

    return user;
  }

  async login(user: any): Promise<AuthResponse> {
    if (!user.is_active) {
      throw new ForbiddenException('Account is inactive');
    }

    const payload: JwtPayload = {
      sub: user.id,
      github_id: user.github_id,
      role: user.role,
    };

    const access_token = this.jwtService.sign(payload, { expiresIn: '3m' });
    const refresh_token = this.jwtService.sign(payload, { expiresIn: '5m' });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: refresh_token, last_login_at: new Date() },
    });

    return {
      status: 'success',
      access_token,
      refresh_token,
      user: {
        id: user.id as string,
        username: user.username as string,
        role: user.role as 'ADMIN' | 'ANALYST',
      },
    };
  }

  async refreshToken(oldRefreshToken: string) {
    let payload: JwtPayload;

    try {
      payload = this.jwtService.verify<JwtPayload>(oldRefreshToken);
    } catch {
      throw new UnauthorizedException('Refresh token expired or invalid');
    }

    const user = await this.prisma.user.findFirst({
      where: { refreshToken: oldRefreshToken },
    });

    if (!user) throw new UnauthorizedException('Invalid refresh token');
    if (!user.is_active) throw new ForbiddenException('Account is inactive');

    const newPayload: JwtPayload = {
      sub: payload.sub,
      github_id: payload.github_id,
      role: payload.role,
    };

    const newAccessToken = this.jwtService.sign(newPayload, {
      expiresIn: '3m',
    });
    const newRefreshToken = this.jwtService.sign(newPayload, {
      expiresIn: '5m',
    });

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async exchangeCodeForUser(code: string, _code_verifier?: string) {
    try {
      const params = new URLSearchParams({
        client_id: this.configService.getOrThrow<string>('GITHUB_CLIENT_ID'),
        client_secret: this.configService.getOrThrow<string>(
          'GITHUB_CLIENT_SECRET',
        ),
        code,
        redirect_uri: this.configService.getOrThrow<string>(
          'GITHUB_CALLBACK_URL',
        ),
      });

      const tokenRes = await fetch(
        `https://github.com/login/oauth/access_token?${params.toString()}`,
        { headers: { Accept: 'application/json' } },
      );
      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };

      if (!tokenData.access_token) {
        throw new UnauthorizedException('Github rejected the code');
      }

      const profileRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const profile = (await profileRes.json()) as {
        id: number;
        login: string;
        email?: string;
        avatar_url?: string;
      };

      const userData: GithubProfile = {
        github_id: String(profile.id),
        username: profile.login,
        email: profile.email,
        avatar_url: profile.avatar_url,
      };

      return this.validateOAuthUser(userData);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new InternalServerErrorException(
        'Failed to exchange code with GitHub',
      );
    }
  }

  async findOrCreateTestAdmin() {
    const existing = await this.prisma.user.findUnique({
      where: { github_id: 'test_admin_001' },
    });

    if (existing) return existing;

    return await this.prisma.user.create({
      data: {
        github_id: 'test_admin_001',
        username: 'test_admin',
        email: 'admin@test.com',
        role: 'ADMIN',
        is_active: true,
      },
    });
  }

  async findOrCreateTestAnalyst() {
    const existing = await this.prisma.user.findUnique({
      where: { github_id: 'test_analyst_001' },
    });

    if (existing) return existing;

    return await this.prisma.user.create({
      data: {
        github_id: 'test_analyst_001',
        username: 'test_analyst',
        email: 'analyst@test.com',
        role: 'ANALYST',
        is_active: true,
      },
    });
  }

  // to get analyst test token
  async getAnalystTestToken() {
    const analyst = await this.findOrCreateTestAnalyst();
    return this.login(analyst);
  }
}
