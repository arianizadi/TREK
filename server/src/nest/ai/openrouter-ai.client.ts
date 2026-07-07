import type { AiActionPlan, AiUsage } from '@trek/shared';
import { aiActionPlanSchema } from '@trek/shared';

import { Injectable } from '@nestjs/common';
import {
  DEFAULT_OPENROUTER_REASONING_EFFORT,
  normalizeOpenRouterReasoningEffort,
  type OpenRouterReasoningEffort,
} from '../../services/llmConfig';

export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENROUTER_MODEL = 'qwen/qwen3.5-397b-a17b';

const CHAT_MAX_TOKENS = 4096;
const PREVIEW_MAX_TOKENS = 4096;
const TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 180_000;

export interface OpenRouterConfig {
  provider: 'openrouter';
  model: string;
  baseUrl: string;
  apiKey: string;
  reasoningEffort: OpenRouterReasoningEffort;
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: OpenRouterUsage;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  cost?: number;
}

@Injectable()
export class OpenRouterAiClient {
  resolveConfig(override?: Partial<OpenRouterConfig>): OpenRouterConfig {
    const suppliedApiKey = typeof override?.apiKey === 'string' && override.apiKey.trim()
      ? override.apiKey.trim()
      : undefined;
    const apiKey = suppliedApiKey || process.env.OPENROUTER_API_KEY || process.env.openrouter;
    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured');
    }
    const baseUrl = (override?.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, '');
    if (override?.baseUrl && !suppliedApiKey && !isOpenRouterBase(baseUrl)) {
      throw new Error('Custom OpenRouter base URLs require a request-supplied API key');
    }
    return {
      provider: 'openrouter',
      model: override?.model || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      baseUrl,
      apiKey,
      reasoningEffort: normalizeOpenRouterReasoningEffort(override?.reasoningEffort)
        ?? normalizeOpenRouterReasoningEffort(process.env.OPENROUTER_REASONING_EFFORT)
        ?? DEFAULT_OPENROUTER_REASONING_EFFORT,
    };
  }

  async completeText(config: OpenRouterConfig, messages: OpenRouterMessage[]): Promise<{ content: string; usage?: AiUsage }> {
    const data = await this.postCompletion(config, {
      model: config.model,
      messages,
      max_tokens: CHAT_MAX_TOKENS,
      temperature: 0.4,
      ...reasoningParams(config),
    });
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: toUsage(config, data.usage),
    };
  }

  async completePlan(config: OpenRouterConfig, messages: OpenRouterMessage[]): Promise<AiActionPlan> {
    const first = await this.completePlanOnce(config, messages);
    if (first.ok) return first.plan;
    const firstError = 'error' in first ? first.error : 'unknown validation error';
    const firstContent = 'content' in first ? first.content : '';

    const repair = await this.completePlanOnce(config, [
      ...messages,
      {
        role: 'user',
        content: [
          'The previous response was not valid against the required action-plan JSON schema.',
          'Return only corrected JSON. Do not include markdown.',
          `Validation error: ${firstError}`,
          `Previous response: ${firstContent.slice(0, 6000)}`,
        ].join('\n\n'),
      },
    ]);
    if (repair.ok) return repair.plan;
    const repairError = 'error' in repair ? repair.error : 'unknown validation error';
    throw new Error(`AI returned an invalid action plan: ${repairError}`);
  }

  private async completePlanOnce(
    config: OpenRouterConfig,
    messages: OpenRouterMessage[],
  ): Promise<{ ok: true; plan: AiActionPlan } | { ok: false; error: string; content: string }> {
    const data = await this.postCompletion(config, {
      model: config.model,
      messages,
      max_tokens: PREVIEW_MAX_TOKENS,
      temperature: 0.2,
      ...reasoningParams(config),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'trek_ai_action_plan',
          strict: true,
          schema: actionPlanJsonSchema(),
        },
      },
    });
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = parseJson(content);
    const validated = aiActionPlanSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, error: validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), content };
    }
    return { ok: true, plan: { ...validated.data, usage: toUsage(config, data.usage) } };
  }

  async streamText(
    config: OpenRouterConfig,
    messages: OpenRouterMessage[],
    handlers: {
      token: (token: string) => void;
      usage: (usage: AiUsage) => void;
    },
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    if (options?.signal?.aborted) controller.abort();
    else options?.signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const res = await this.fetchCompletion(config, {
        model: config.model,
        messages,
        max_tokens: CHAT_MAX_TOKENS,
        temperature: 0.4,
        stream: true,
        stream_options: { include_usage: true },
        ...reasoningParams(config),
      }, { signal: controller.signal });
      if (!res.body) throw new Error('OpenRouter returned an empty stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const event of events) {
            const payload = sseData(event);
            if (!payload || payload === '[DONE]') continue;
            let parsed: { choices?: Array<{ delta?: { content?: string | null } }>; usage?: OpenRouterUsage };
            try {
              parsed = JSON.parse(payload) as typeof parsed;
            } catch {
              continue;
            }
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) handlers.token(token);
            if (parsed.usage) handlers.usage(toUsage(config, parsed.usage));
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearTimeout(deadline);
      options?.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  async testConnection(override?: Partial<OpenRouterConfig>) {
    const config = this.resolveConfig(override);
    const modelsRes = await fetch(`${config.baseUrl}/models`, {
      headers: this.headers(config),
    });
    if (!modelsRes.ok) {
      throw new Error(`OpenRouter models check failed (${modelsRes.status})`);
    }
    const modelsJson = (await modelsRes.json()) as { data?: Array<{ id: string; supported_parameters?: string[] }> };
    const model = modelsJson.data?.find(m => m.id === config.model);
    const supported = model?.supported_parameters ?? [];
    const supportsReasoning = supported.includes('reasoning');
    const supportsStructuredOutputs = supported.includes('structured_outputs') || supported.includes('response_format');

    await this.postCompletion(config, {
      model: config.model,
      messages: [
        { role: 'system', content: 'Respond with exactly: ok' },
        { role: 'user', content: 'Connection check.' },
      ],
      max_tokens: 16,
      temperature: 0,
      ...reasoningParams(config),
    });

    return {
      ok: true,
      provider: 'openrouter' as const,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      supportsReasoning,
      supportsStructuredOutputs,
      message: model ? undefined : 'Model was not present in /models response, but the chat request succeeded',
    };
  }

  private async postCompletion(config: OpenRouterConfig, body: Record<string, unknown>): Promise<ChatResponse> {
    const res = await this.fetchCompletion(config, body);
    return (await res.json()) as ChatResponse;
  }

  private async fetchCompletion(config: OpenRouterConfig, body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<Response> {
    const controller = options?.signal ? null : new AbortController();
    const signal = options?.signal ?? controller!.signal;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: this.headers(config),
        body: JSON.stringify(body),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenRouter request failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    return res;
  }

  private headers(config: OpenRouterConfig): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'http://localhost',
      'X-OpenRouter-Title': 'TREK',
    };
  }
}

function reasoningParams(config: OpenRouterConfig): { reasoning: { effort: OpenRouterReasoningEffort }; include_reasoning: false } {
  return {
    reasoning: { effort: config.reasoningEffort },
    include_reasoning: false,
  };
}

function toUsage(config: OpenRouterConfig, usage?: OpenRouterUsage): AiUsage {
  return {
    provider: 'openrouter',
    model: config.model,
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    total_tokens: usage?.total_tokens,
    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens,
    cost: usage?.cost,
  };
}

function parseJson(content: string): unknown {
  const stripped = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function sseData(event: string): string | null {
  const lines = event.split('\n');
  const dataLines = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart());
  return dataLines.length ? dataLines.join('\n') : null;
}

function isOpenRouterBase(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai';
  } catch {
    return false;
  }
}

function actionPlanJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'title', 'summary', 'assumptions', 'warnings', 'alternatives', 'riskLevel', 'operations'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      assumptions: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      alternatives: { type: 'array', items: { type: 'string' } },
      riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
      operations: {
        type: 'array',
        items: {
          anyOf: [
            operationSchema('create_place', {
              data: placeDataSchema(['name']),
              assignToDayId: stringOrNumberSchema,
              assignmentNotes: nullableStringSchema,
            }),
            operationSchema('assign_place_to_day', {
              dayId: stringOrNumberSchema,
              placeId: stringOrNumberSchema,
              placeOperationId: { type: 'string' },
              notes: nullableStringSchema,
            }),
            operationSchema('reorder_itinerary', {
              dayId: stringOrNumberSchema,
              orderedIds: { type: 'array', items: { type: 'number' } },
            }),
            operationSchema('add_day_note', {
              dayId: stringOrNumberSchema,
              data: {
                type: 'object',
                additionalProperties: false,
                required: ['text'],
                properties: {
                  text: { type: 'string' },
                  time: { type: 'string' },
                  icon: { type: 'string' },
                  sort_order: { type: 'number' },
                },
              },
            }),
            operationSchema('create_budget_item', { data: budgetDataSchema }),
            operationSchema('create_packing_item', { data: packingDataSchema }),
            operationSchema('create_poll', { data: pollDataSchema }),
            operationSchema('import_reservation', { data: reservationDataSchema(['title']) }),
            operationSchema('update_reservation', {
              reservationId: stringOrNumberSchema,
              data: reservationDataSchema([]),
            }),
            operationSchema('delete_reservation', {
              reservationId: stringOrNumberSchema,
            }),
          ],
        },
      },
    },
  } as const;
}

const stringOrNumberSchema = { anyOf: [{ type: 'string' }, { type: 'number' }] } as const;
const nullableStringSchema = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

function operationSchema(type: string, properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', ...Object.keys(properties).filter(k => !OPTIONAL_OPERATION_PROPS.has(k))],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      warning: { type: 'string' },
      type: { type: 'string', const: type },
      ...properties,
    },
  } as const;
}

const OPTIONAL_OPERATION_PROPS = new Set(['notes', 'assignToDayId', 'assignmentNotes', 'placeId', 'placeOperationId']);

function placeDataSchema(required: string[] = []) {
  return {
    type: 'object',
    additionalProperties: true,
    required,
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      lat: { type: 'number' },
      lng: { type: 'number' },
      address: { type: 'string' },
      category_id: { type: 'number' },
      price: { type: 'number' },
      currency: { type: 'string' },
      place_time: { type: 'string' },
      end_time: { type: 'string' },
      duration_minutes: { type: 'number' },
      notes: { type: 'string' },
      website: { type: 'string' },
      phone: { type: 'string' },
      transport_mode: { type: 'string' },
    },
  } as const;
}

const budgetDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    category: { type: 'string' },
    total_price: { type: 'number' },
    currency: nullableStringSchema,
    persons: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    days: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    note: nullableStringSchema,
    expense_date: nullableStringSchema,
    member_ids: { type: 'array', items: { type: 'number' } },
  },
} as const;

const packingDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    category: { type: 'string' },
    checked: { type: 'boolean' },
    is_private: { type: 'boolean' },
    visibility: { type: 'string', enum: ['common', 'personal', 'shared'] },
    recipient_ids: { type: 'array', items: { type: 'number' } },
  },
} as const;

const pollDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['question', 'options'],
  properties: {
    question: { type: 'string' },
    options: { type: 'array', minItems: 2, items: {} },
    multiple: { type: 'boolean' },
    multiple_choice: { type: 'boolean' },
    deadline: { type: 'string' },
  },
} as const;

function reservationDataSchema(required: string[] = []) {
  return {
    type: 'object',
    additionalProperties: true,
    required,
    properties: {
      title: { type: 'string' },
      type: { type: 'string' },
      day_id: stringOrNumberSchema,
      end_day_id: stringOrNumberSchema,
      place_id: stringOrNumberSchema,
      assignment_id: stringOrNumberSchema,
      reservation_time: nullableStringSchema,
      reservation_end_time: nullableStringSchema,
      location: nullableStringSchema,
      confirmation_number: nullableStringSchema,
      notes: nullableStringSchema,
      status: { type: 'string' },
      url: nullableStringSchema,
      metadata: {},
      needs_review: { type: 'boolean' },
      create_budget_entry: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total_price: { type: 'number' },
          category: { type: 'string' },
        },
      },
      endpoints: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'name', 'lat', 'lng'],
          properties: {
            role: { type: 'string', enum: ['from', 'to', 'stop'] },
            sequence: { type: 'number' },
            name: { type: 'string' },
            code: nullableStringSchema,
            lat: { type: 'number' },
            lng: { type: 'number' },
            timezone: nullableStringSchema,
            local_time: nullableStringSchema,
            local_date: nullableStringSchema,
          },
        },
      },
    },
  } as const;
}
