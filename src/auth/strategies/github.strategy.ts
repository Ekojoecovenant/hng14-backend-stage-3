/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { AuthService } from '../auth.service';
import { GithubProfile } from '../interfaces/user.interface';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GITHUB_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GITHUB_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GITHUB_CALLBACK_URL'),
      scope: ['user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (error: any, user?: any) => void,
  ): Promise<any> {
    try {
      const userData: GithubProfile = {
        github_id: String(profile.id),
        username: profile.username || profile.displayName,
        email: profile.emails?.[0]?.value,
        avatar_url: profile.photos?.[0]?.value,
      };

      const savedUser = await this.authService.validateOAuthUser(userData);
      console.log('✅ User authenticated:', savedUser.username);

      done(null, savedUser);
    } catch (err) {
      done(err, null);
    }
  }
}
