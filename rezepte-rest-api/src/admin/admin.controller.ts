import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { OllamaService, QueueEntry } from '../ai/ollama.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly ollama: OllamaService) {}

  @Get('ollama-queue')
  ollamaQueue(): { now: number; entries: QueueEntry[] } {
    return {
      now: Date.now(),
      entries: this.ollama.getQueueSnapshot(),
    };
  }

  @Post('ollama-queue/cancel')
  @HttpCode(200)
  cancel(@Body() body: { id: number }): { ok: boolean } {
    return { ok: this.ollama.cancel(body.id) };
  }

  @Post('ollama-queue/cancel-all')
  @HttpCode(200)
  cancelAll(): Promise<{ cancelled: number }> {
    return this.ollama.cancelAllAndUnload();
  }
}
