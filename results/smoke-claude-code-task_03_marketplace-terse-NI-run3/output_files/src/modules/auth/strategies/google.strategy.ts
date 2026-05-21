import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';

/**
 * Google OAuth 2.0. Only enabled when GOOGLE_CLIENT_ID is configured; the
 * AuthModule conditionally registers this provider.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') || 'disabled',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') || 'disabled',
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL') || 'http://localhost/cb',
      scope: ['email', 'profile'],
    });
  }

  validate(_at: string, _rt: string, profile: Profile, done: VerifyCallback) {
    done(null, {
      providerUserId: profile.id,
      email: profile.emails?.[0]?.value ?? '',
      displayName: profile.displayName ?? 'Google User',
    });
  }
}
