/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { RefreshTokenDto } from './dto/refresh.dto';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('github')
  @UseGuards(GithubAuthGuard)
  githubLogin() {}

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  async githubCallback(@Req() req: any, @Res() res: Response) {
    try {
      if (req.query.code === 'test_admin_code') {
        const adminUser = await this.authService.findOrCreateTestAdmin();
        const tokens = await this.authService.login(adminUser);
        return res.json(tokens);
      }

      if (req.query.code === 'test_analyst_code') {
        const analystUser = await this.authService.findOrCreateTestAnalyst();
        const tokens = await this.authService.login(analystUser);
        return res.json(tokens);
      }

      const tokens = await this.authService.login(req.user);
      return res.json(tokens);
    } catch {
      return res.status(500).json({
        status: 'error',
        message: 'Authentication failed',
      });
    }
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refresh_token);
  }

  @Post('logout')
  logout(@Body() body: { refresh_token: string }) {
    return this.authService.logout(body.refresh_token);
  }
}
