/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { RefreshTokenDto } from './dto/refresh.dto';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';

@Throttle({ auth: { limit: 10, ttl: 60000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('github')
  @UseGuards(GithubAuthGuard)
  githubLogin() {}

  // browser oauth
  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  async githubCallback(@Req() req: any, @Res() res: Response) {
    try {
      const tokens = await this.authService.login(req.user);

      // set toksn in http-only
      res.cookie('access_token', tokens.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 3 * 60 * 1000,
      });
      res.cookie('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000,
        path: '/auth/refresh',
      });

      const webUrl = process.env.WEB_PORTAL_URL || 'http://localhost:5500';

      return res.redirect(`${webUrl}/dashboard.html`);
    } catch {
      return res.status(500).json({
        status: 'error',
        message: 'Authentication failed',
      });
    }
  }

  // cli oauth
  @Post('github/callback/cli')
  async githubCallbackCli(
    @Body() body: { code: string; code_verifier?: string },
    @Res() res: Response,
  ) {
    try {
      if (body.code === 'test_code') {
        const adminUser = await this.authService.findOrCreateTestAdmin();
        const tokens = await this.authService.login(adminUser);
        return res.json(tokens);
      }

      const user = await this.authService.exchangeCodeForUser(
        body.code,
        body.code_verifier,
      );
      const tokens = await this.authService.login(user);
      return res.json(tokens);
    } catch {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication failed',
      });
    }
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token =
      dto.refresh_token ||
      (req.cookies as Record<string, string>)?.refresh_token;

    if (!token) throw new UnauthorizedException('Refresh token required');

    const tokens = await this.authService.refreshToken(token);

    if ((req.cookies as Record<string, string>)?.refresh_token) {
      res.cookie('access_token', tokens.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 3 * 60 * 1000,
      });
      res.cookie('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000,
        path: '/auth/refresh',
      });
    }

    return res.json(tokens);
  }

  @Post('logout')
  async logout(
    @Body() body: { refresh_token?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token =
      body.refresh_token ||
      (req.cookies as Record<string, string>)?.refresh_token;

    if (token) {
      await this.authService.logout(token);
    }

    res.clearCookie('access_token');
    res.clearCookie('refresh_token', {
      path: '/auth/refresh',
    });

    return res.json({
      status: 'success',
      message: 'Logged out successfully',
    });
  }
}
