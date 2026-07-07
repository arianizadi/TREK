import type { AiUsage } from '@trek/shared';

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { logError } from '../../services/auditLog';

type AiUsageStatus = 'ok' | 'error';
type AiRequestKind = 'chat' | 'preview' | 'apply' | 'test';

interface RecordAiUsageInput {
  userId: number;
  tripId?: string | number | null;
  requestKind: AiRequestKind;
  provider?: string;
  model?: string;
  status?: AiUsageStatus;
  usage?: AiUsage;
  requestPayload?: unknown;
  responsePayload?: unknown;
  error?: unknown;
  ip?: string | null;
  durationMs?: number;
}

interface AiUsageRow {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string | null;
  user_email: string | null;
  trip_id: number | null;
  trip_title: string | null;
  request_kind: AiRequestKind;
  provider: string;
  model: string | null;
  status: AiUsageStatus;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  reasoning_tokens: number | null;
  cost: number | null;
  request_payload: string | null;
  response_payload: string | null;
  error: string | null;
  ip: string | null;
  duration_ms: number | null;
}

const DEFAULT_LIMIT = 100;

@Injectable()
export class AiUsageService {
  constructor(private readonly db: DatabaseService) {}

  record(input: RecordAiUsageInput): void {
    try {
      const usage = input.usage;
      this.db.run(
        `
          INSERT INTO ai_usage_events (
            user_id, trip_id, request_kind, provider, model, status,
            prompt_tokens, completion_tokens, total_tokens, reasoning_tokens, cost,
            request_payload, response_payload, error, ip, duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        input.userId,
        numericId(input.tripId),
        input.requestKind,
        input.provider || usage?.provider || 'openrouter',
        input.model || usage?.model || null,
        input.status || 'ok',
        nullableNumber(usage?.prompt_tokens),
        nullableNumber(usage?.completion_tokens),
        nullableNumber(usage?.total_tokens),
        nullableNumber(usage?.reasoning_tokens),
        nullableNumber(usage?.cost),
        jsonOrNull(input.requestPayload),
        jsonOrNull(input.responsePayload),
        input.error == null ? null : errorMessage(input.error),
        input.ip ?? null,
        nullableNumber(input.durationMs),
      );
    } catch (err) {
      logError(`AI usage audit write failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  getAdminUsage(query: { days?: string; limit?: string; offset?: string }) {
    const daysRaw = parseInt(String(query.days || '30'), 10);
    const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 30, 0), 3650);
    const limitRaw = parseInt(String(query.limit || DEFAULT_LIMIT), 10);
    const offsetRaw = parseInt(String(query.offset || '0'), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1), 500);
    const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

    const where = days > 0 ? "WHERE e.created_at >= datetime('now', ?)" : '';
    const params = days > 0 ? [`-${days} days`] : [];

    const totals = this.db.get<{
      requests: number;
      errors: number;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      reasoning_tokens: number | null;
      cost: number | null;
    }>(
      `
        SELECT
          COUNT(*) as requests,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(prompt_tokens) as prompt_tokens,
          SUM(completion_tokens) as completion_tokens,
          SUM(total_tokens) as total_tokens,
          SUM(reasoning_tokens) as reasoning_tokens,
          SUM(cost) as cost
        FROM ai_usage_events e
        ${where}
      `,
      ...params,
    ) ?? { requests: 0, errors: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cost: 0 };

    const byUser = this.db.all(
      `
        SELECT
          e.user_id,
          u.username,
          u.email as user_email,
          COUNT(*) as requests,
          SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(e.prompt_tokens) as prompt_tokens,
          SUM(e.completion_tokens) as completion_tokens,
          SUM(e.total_tokens) as total_tokens,
          SUM(e.reasoning_tokens) as reasoning_tokens,
          SUM(e.cost) as cost,
          MAX(e.created_at) as last_used_at
        FROM ai_usage_events e
        LEFT JOIN users u ON u.id = e.user_id
        ${where}
        GROUP BY e.user_id, u.username, u.email
        ORDER BY COALESCE(SUM(e.cost), 0) DESC, COALESCE(SUM(e.total_tokens), 0) DESC
      `,
      ...params,
    );

    const byModel = this.db.all(
      `
        SELECT
          provider,
          model,
          COUNT(*) as requests,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(total_tokens) as total_tokens,
          SUM(reasoning_tokens) as reasoning_tokens,
          SUM(cost) as cost
        FROM ai_usage_events e
        ${where}
        GROUP BY provider, model
        ORDER BY COALESCE(SUM(cost), 0) DESC, COALESCE(SUM(total_tokens), 0) DESC
      `,
      ...params,
    );

    const rows = this.db.all<AiUsageRow>(
      `
        SELECT
          e.id, e.created_at, e.user_id, u.username, u.email as user_email,
          e.trip_id, t.title as trip_title, e.request_kind, e.provider, e.model, e.status,
          e.prompt_tokens, e.completion_tokens, e.total_tokens, e.reasoning_tokens, e.cost,
          e.request_payload, e.response_payload, e.error, e.ip, e.duration_ms
        FROM ai_usage_events e
        LEFT JOIN users u ON u.id = e.user_id
        LEFT JOIN trips t ON t.id = e.trip_id
        ${where}
        ORDER BY e.id DESC
        LIMIT ? OFFSET ?
      `,
      ...params,
      limit,
      offset,
    );

    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ai_usage_events e ${where}`, ...params)?.c ?? 0;

    return {
      days,
      totals: normalizeTotals(totals),
      byUser: byUser.map(normalizeAggregate),
      byModel: byModel.map(normalizeAggregate),
      events: rows.map(row => ({
        ...row,
        created_at: normalizeSqliteTime(row.created_at),
        request_payload: parsePayload(row.request_payload),
        response_payload: parsePayload(row.response_payload),
      })),
      total,
      limit,
      offset,
    };
  }
}

function numericId(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jsonOrNull(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(redactSensitive(value));
}

function parsePayload(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { _parse_error: true };
  }
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      out[key] = '[redacted]';
    } else if (key === 'serverSignature') {
      out[key] = '[redacted]';
    } else {
      out[key] = redactSensitive(item);
    }
  }
  return out;
}

function isSecretKey(key: string): boolean {
  return /api[-_]?key|authorization|bearer|token|secret|password|openrouter/i.test(key);
}

function normalizeTotals(row: Record<string, unknown>) {
  return {
    requests: Number(row.requests) || 0,
    errors: Number(row.errors) || 0,
    prompt_tokens: Number(row.prompt_tokens) || 0,
    completion_tokens: Number(row.completion_tokens) || 0,
    total_tokens: Number(row.total_tokens) || 0,
    reasoning_tokens: Number(row.reasoning_tokens) || 0,
    cost: Number(row.cost) || 0,
  };
}

function normalizeAggregate<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    requests: Number(row.requests) || 0,
    errors: Number(row.errors) || 0,
    prompt_tokens: Number(row.prompt_tokens) || 0,
    completion_tokens: Number(row.completion_tokens) || 0,
    total_tokens: Number(row.total_tokens) || 0,
    reasoning_tokens: Number(row.reasoning_tokens) || 0,
    cost: Number(row.cost) || 0,
    last_used_at: typeof row.last_used_at === 'string' ? normalizeSqliteTime(row.last_used_at) : row.last_used_at,
  };
}

function normalizeSqliteTime(value: string): string {
  return value && !value.endsWith('Z') ? value.replace(' ', 'T') + 'Z' : value;
}
