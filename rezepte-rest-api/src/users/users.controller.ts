import { Controller, Get, Query } from '@nestjs/common';
import { UsersService, UserSearchResult } from './users.service';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('search')
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') q: string,
  ): Promise<UserSearchResult[]> {
    return this.users.search(q ?? '', user.userId);
  }
}
