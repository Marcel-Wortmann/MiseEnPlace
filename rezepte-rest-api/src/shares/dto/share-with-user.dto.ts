import { IsUUID } from 'class-validator';

export class ShareWithUserDto {
  @IsUUID()
  userId!: string;
}
