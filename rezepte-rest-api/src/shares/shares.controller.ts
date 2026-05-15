import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SharesService } from './shares.service';
import { ShareWithUserDto } from './dto/share-with-user.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ShareInfo } from '@shared/interfaces/share.interface';

@Controller('shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  // ----- Recipes -----

  @Get('recipes/:id')
  recipeShareInfo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShareInfo> {
    return this.shares.getShareInfo('recipe', id, user.userId);
  }

  @Post('recipes/:id/link')
  async createRecipeLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ shareToken: string }> {
    const token = await this.shares.ensureShareToken('recipe', id, user.userId);
    return { shareToken: token };
  }

  @Delete('recipes/:id/link')
  @HttpCode(204)
  async revokeRecipeLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.shares.revokeShareToken('recipe', id, user.userId);
  }

  @Post('recipes/:id/users')
  @HttpCode(204)
  async shareRecipeWithUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShareWithUserDto,
  ): Promise<void> {
    await this.shares.shareWithUser('recipe', id, user.userId, dto.userId);
  }

  @Delete('recipes/:id/users/:userId')
  @HttpCode(204)
  async unshareRecipeWithUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    await this.shares.unshareWithUser('recipe', id, user.userId, targetUserId);
  }

  // ----- Ideas -----

  @Get('ideas/:id')
  ideaShareInfo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShareInfo> {
    return this.shares.getShareInfo('idea', id, user.userId);
  }

  @Post('ideas/:id/link')
  async createIdeaLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ shareToken: string }> {
    const token = await this.shares.ensureShareToken('idea', id, user.userId);
    return { shareToken: token };
  }

  @Delete('ideas/:id/link')
  @HttpCode(204)
  async revokeIdeaLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.shares.revokeShareToken('idea', id, user.userId);
  }

  @Post('ideas/:id/users')
  @HttpCode(204)
  async shareIdeaWithUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShareWithUserDto,
  ): Promise<void> {
    await this.shares.shareWithUser('idea', id, user.userId, dto.userId);
  }

  @Delete('ideas/:id/users/:userId')
  @HttpCode(204)
  async unshareIdeaWithUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    await this.shares.unshareWithUser('idea', id, user.userId, targetUserId);
  }

  // ----- Wines -----

  @Get('wines/:id')
  wineShareInfo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShareInfo> {
    return this.shares.getShareInfo('wine', id, user.userId);
  }

  @Post('wines/:id/link')
  async createWineLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ shareToken: string }> {
    const token = await this.shares.ensureShareToken('wine', id, user.userId);
    return { shareToken: token };
  }

  @Delete('wines/:id/link')
  @HttpCode(204)
  async revokeWineLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.shares.revokeShareToken('wine', id, user.userId);
  }

  @Post('wines/:id/users')
  @HttpCode(204)
  async shareWineWithUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShareWithUserDto,
  ): Promise<void> {
    await this.shares.shareWithUser('wine', id, user.userId, dto.userId);
  }

  @Delete('wines/:id/users/:userId')
  @HttpCode(204)
  async unshareWineWithUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    await this.shares.unshareWithUser('wine', id, user.userId, targetUserId);
  }

  // ----- Public read-only via share token -----

  @Public()
  @Get('public/recipes/:token')
  async publicRecipe(@Param('token') token: string) {
    const entity = await this.shares.findByShareToken('recipe', token);
    if (!entity) throw new NotFoundException('Geteilter Eintrag nicht gefunden.');
    return entity;
  }

  @Public()
  @Get('public/ideas/:token')
  async publicIdea(@Param('token') token: string) {
    const entity = await this.shares.findByShareToken('idea', token);
    if (!entity) throw new NotFoundException('Geteilter Eintrag nicht gefunden.');
    return entity;
  }

  @Public()
  @Get('public/wines/:token')
  async publicWine(@Param('token') token: string) {
    const entity = await this.shares.findByShareToken('wine', token);
    if (!entity) throw new NotFoundException('Geteilter Eintrag nicht gefunden.');
    return entity;
  }
}
