import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET muss in Production gesetzt sein. Bitte .env prüfen.');
}

@Module({
  imports: [
    JwtModule.register({
      secret: jwtSecret ?? 'CHANGE_ME_DEV_ONLY',
      signOptions: { issuer: 'rezepte-api' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TotpService],
  exports: [JwtModule, AuthService, TotpService],
})
export class AuthModule {}
