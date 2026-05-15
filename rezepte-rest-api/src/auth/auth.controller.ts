import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, AuthUser } from './decorators/current-user.decorator';
import { AuthResponse, AuthTokens, User } from '@shared/interfaces/auth.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly totp: TotpService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<AuthResponse | { totpRequired: true; userId: string }> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.getProfile(user.userId);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<User> {
    return this.auth.updateProfile(user.userId, dto);
  }

  @Patch('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user.userId, dto);
  }

  @Delete('me')
  @HttpCode(204)
  async deleteAccount(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.deleteAccount(user.userId);
  }

  @Post('totp/setup')
  totpSetup(@CurrentUser() user: AuthUser): Promise<{ secret: string; qrDataUrl: string; otpauthUrl: string }> {
    return this.totp.generateSetup(user.userId, user.email);
  }

  @Post('totp/enable')
  totpEnable(
    @CurrentUser() user: AuthUser,
    @Body() body: { code: string },
  ): Promise<{ recoveryCodes: string[] }> {
    return this.totp.confirmEnable(user.userId, body.code);
  }

  @Post('totp/disable')
  @HttpCode(204)
  async totpDisable(
    @CurrentUser() user: AuthUser,
    @Body() body: { password: string },
  ): Promise<void> {
    await this.totp.disable(user.userId, body.password);
  }
}
