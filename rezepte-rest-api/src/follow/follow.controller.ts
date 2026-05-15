import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { FollowService } from './follow.service';

@Controller('follow')
@UseGuards(JwtAuthGuard)
export class FollowController {
  constructor(private readonly service: FollowService) {}

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') q: string) {
    return this.service.searchByEmail(user.userId, q ?? '');
  }

  @Get('following')
  listFollowing(@CurrentUser() user: AuthUser) {
    return this.service.listFollowing(user.userId);
  }

  @Get('feed')
  feed(@CurrentUser() user: AuthUser) {
    return this.service.feed(user.userId);
  }

  @Post(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  follow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.follow(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfollow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.unfollow(user.userId, id);
  }

  @Post('recipe/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  followRecipe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.followRecipe(user.userId, id);
  }

  @Delete('recipe/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfollowRecipe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.unfollowRecipe(user.userId, id);
  }
}
