import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Requires a valid access token. Apply with @UseGuards(JwtAuthGuard). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
