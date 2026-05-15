import { IsEmail, IsOptional, IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Mindestens 10 Zeichen' })
  @MaxLength(200)
  @Matches(/[a-z]/, { message: 'Mindestens ein Kleinbuchstabe' })
  @Matches(/[A-Z]/, { message: 'Mindestens ein Großbuchstabe' })
  @Matches(/[0-9]/, { message: 'Mindestens eine Zahl' })
  password!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_-]+$/i, { message: 'Nur Buchstaben, Zahlen, _ und - erlaubt' })
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;
}
