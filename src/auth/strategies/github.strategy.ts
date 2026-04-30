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
      callbackURL: 'http://localhost:3000/auth/github/callback',
      scope: ['user:email'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: (error: any, user?: any) => void,
  ): Promise<any> {
    try {
      // console.log('GitHub Profile:', {
      //   id: profile.id,
      //   username: profile.username,
      //   email: profile.emails?.[0]?.value,
      // });

      const userData: GithubProfile = {
        github_id: profile.id,
        username: profile.username || profile.displayName,
        email: profile.emails?.[0]?.value,
        avatar_url: profile.photos?.[0]?.value,
      };

      const savedUser = await this.authService.validateOAuthUser(userData);
      console.log('✅ User authenticated:', savedUser.username);

      done(null, savedUser);
    } catch (err) {
      console.error('❌ Github validate error:', err);
      done(err, null);
    }
  }
}
