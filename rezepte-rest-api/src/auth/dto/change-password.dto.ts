import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'Mindestens 10 Zeichen' })
  @MaxLength(200)
  @Matches(/[a-z]/, { message: 'Mindestens ein Kleinbuchstabe' })
  @Matches(/[A-Z]/, { message: 'Mindestens ein Großbuchstabe' })
  @Matches(/[0-9]/, { message: 'Mindestens eine Zahl' })
  newPassword!: string;
}
