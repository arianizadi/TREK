import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { aiActionApplyRequestSchema, aiActionPreviewRequestSchema, aiActionUndoRequestSchema, aiTestConnectionRequestSchema, type AiTestConnectionRequest } from '@trek/shared';
import type { User } from '../../types';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveLlmConfig } from '../llm-parse/llm-config.resolver';
import { getClientIp } from '../../services/auditLog';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AiCopilotService } from './ai-copilot.service';
import { AiUsageService } from './ai-usage.service';
import { OpenRouterAiClient } from './openrouter-ai.client';

@Controller('api/ai')
@UseGuards(JwtAuthGuard)
export class AiCopilotController {
  constructor(
    private readonly ai: AiCopilotService,
    private readonly limits: AiRateLimitService,
  ) {}

  @Post('chat')
  @HttpCode(200)
  async chat(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.limits.assertAllowed('chat', user.id, requestTripId(body), req.ip);
    const parsed = this.ai.parseChat(body);
    const releaseStream = this.limits.enterStream(user.id, parsed.tripId, req.ip);
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const emit = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15_000);

    try {
      await this.ai.streamChat(user, parsed, emit, getClientIp(req), abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) emit('error', { error: publicError(err) });
    } finally {
      clearInterval(heartbeat);
      releaseStream();
      if (!res.writableEnded) res.end();
    }
  }

  @Post('actions/preview')
  async preview(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request) {
    const parsed = aiActionPreviewRequestSchema.safeParse(body);
    this.limits.assertAllowed('preview', user.id, parsed.success ? parsed.data.tripId : 'invalid', req.ip);
    return { plan: await this.ai.preview(user, body, getClientIp(req)) };
  }

  @Post('actions/apply')
  async apply(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request, @Headers('x-socket-id') socketId?: string) {
    const parsed = aiActionApplyRequestSchema.safeParse(body);
    this.limits.assertAllowed('apply', user.id, parsed.success ? parsed.data.tripId : 'invalid', req.ip);
    return this.ai.apply(user, body, socketId, getClientIp(req));
  }

  @Post('actions/undo')
  async undo(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request, @Headers('x-socket-id') socketId?: string) {
    const parsed = aiActionUndoRequestSchema.safeParse(body);
    this.limits.assertAllowed('undo', user.id, parsed.success ? parsed.data.tripId : 'invalid', req.ip);
    return this.ai.undo(user, body, socketId, getClientIp(req));
  }
}

@Controller('api/admin/ai')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAiController {
  constructor(
    private readonly openRouter: OpenRouterAiClient,
    private readonly limits: AiRateLimitService,
    private readonly usage: AiUsageService,
  ) {}

  @Get('usage')
  usageLog(@Query() query: { days?: string; limit?: string; offset?: string }) {
    return this.usage.getAdminUsage(query);
  }

  @Post('test-connection')
  async testConnection(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request) {
    const startedAt = Date.now();
    this.limits.assertAllowed('test', user.id, 'global', req.ip);
    const parsed = aiTestConnectionRequestSchema.safeParse(body);
    if (!parsed.success) {
      const response = { ok: false, provider: 'openrouter' as const, model: 'unknown', supportsReasoning: false, supportsStructuredOutputs: false, message: 'Invalid request' };
      this.usage.record({
        userId: user.id,
        requestKind: 'test',
        status: 'error',
        requestPayload: { body },
        responsePayload: response,
        error: 'Invalid AI test connection request',
        ip: getClientIp(req),
        durationMs: Date.now() - startedAt,
      });
      return response;
    }
    const override = this.testOverride(user.id, parsed.data);
    try {
      const response = await this.openRouter.testConnection(override);
      this.usage.record({
        userId: user.id,
        requestKind: 'test',
        provider: response.provider,
        model: response.model,
        requestPayload: { body: parsed.data, override },
        responsePayload: response,
        ip: getClientIp(req),
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (err) {
      const config = (() => {
        try { return this.openRouter.resolveConfig(override); } catch { return null; }
      })();
      const response = {
        ok: false,
        provider: 'openrouter' as const,
        model: config?.model || override.model || 'unknown',
        supportsReasoning: false,
        supportsStructuredOutputs: false,
        message: publicError(err),
      };
      this.usage.record({
        userId: user.id,
        requestKind: 'test',
        provider: response.provider,
        model: response.model,
        status: 'error',
        requestPayload: { body: parsed.data, override },
        responsePayload: response,
        error: err,
        ip: getClientIp(req),
        durationMs: Date.now() - startedAt,
      });
      return response;
    }
  }

  private testOverride(userId: number, body: AiTestConnectionRequest) {
    if (body.apiKey) return body;
    if (body.baseUrl && !isOpenRouterBase(body.baseUrl)) return body;
    const saved = resolveLlmConfig(userId);
    if (saved?.provider !== 'openrouter') return body;
    return {
      provider: 'openrouter' as const,
      model: body.model || saved.model,
      baseUrl: body.baseUrl || saved.baseUrl,
      apiKey: saved.apiKey,
      reasoningEffort: body.reasoningEffort || saved.reasoningEffort,
    };
  }
}

function publicError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 500);
}

function requestTripId(body: unknown): string | number {
  if (body && typeof body === 'object') {
    const tripId = (body as { tripId?: unknown }).tripId;
    if (typeof tripId === 'string' || typeof tripId === 'number') return tripId;
  }
  return 'invalid';
}

function isOpenRouterBase(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai';
  } catch {
    return false;
  }
}
