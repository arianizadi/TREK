import { db } from '../../db/database';
import { ADDON_IDS } from '../../addons';
import { isAddonEnabled } from '../../services/adminService';
import { getUserSettings, getDecryptedUserSetting } from '../../services/settingsService';
import {
  decryptLlmApiKey,
  LLM_PROVIDERS,
  normalizeOpenRouterReasoningEffort,
  type LlmProvider,
  type ResolvedLlmConfig,
} from '../../services/llmConfig';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = 'qwen/qwen3.5-397b-a17b';

function asProvider(v: unknown): LlmProvider | null {
  return typeof v === 'string' && (LLM_PROVIDERS as string[]).includes(v) ? (v as LlmProvider) : null;
}

function resolveBaseUrl(provider: LlmProvider, raw: unknown, usingServerOpenRouterKey = false): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (provider === 'openrouter' && usingServerOpenRouterKey && trimmed && !isOpenRouterBase(trimmed)) {
    return OPENROUTER_BASE_URL;
  }
  if (trimmed) return trimmed;
  return provider === 'openrouter' ? OPENROUTER_BASE_URL : undefined;
}

function envOpenRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || process.env.openrouter || undefined;
}

function readInstanceConfig(): ResolvedLlmConfig | null {
  const row = db.prepare('SELECT config FROM addons WHERE id = ?').get(ADDON_IDS.LLM_PARSING) as { config?: string } | undefined;
  if (!row?.config) return null;
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(row.config || '{}');
  } catch {
    return null;
  }
  const provider = asProvider(cfg.provider);
  const model = typeof cfg.model === 'string' ? cfg.model.trim() : '';
  if (!provider || !model) return null;
  const storedApiKey = decryptLlmApiKey(cfg.apiKey);
  const usingEnvOpenRouterKey = provider === 'openrouter' && !storedApiKey;
  return {
    provider,
    model,
    baseUrl: resolveBaseUrl(provider, cfg.baseUrl, usingEnvOpenRouterKey),
    apiKey: storedApiKey ?? (provider === 'openrouter' ? envOpenRouterKey() : undefined),
    multimodal: cfg.multimodal === true,
    reasoningEffort: provider === 'openrouter' ? normalizeOpenRouterReasoningEffort(cfg.reasoningEffort) : undefined,
    allowUnsafeLocalBaseUrl: true,
  };
}

function readUserConfig(userId: number): ResolvedLlmConfig | null {
  const settings = getUserSettings(userId);
  const provider = asProvider(settings.llm_provider);
  const model = typeof settings.llm_model === 'string' ? settings.llm_model.trim() : '';
  if (!provider || !model) return null;
  const apiKey = getDecryptedUserSetting(userId, 'llm_api_key') ?? undefined;
  const usingEnvOpenRouterKey = provider === 'openrouter' && !apiKey;
  return {
    provider,
    model,
    baseUrl: resolveBaseUrl(provider, settings.llm_base_url, usingEnvOpenRouterKey),
    apiKey: apiKey ?? (provider === 'openrouter' ? envOpenRouterKey() : undefined),
    multimodal: settings.llm_multimodal === true,
    allowUnsafeLocalBaseUrl: false,
  };
}

function readEnvConfig(): ResolvedLlmConfig | null {
  const apiKey = envOpenRouterKey();
  if (!apiKey) return null;
  return {
    provider: 'openrouter',
    model: process.env.OPENROUTER_MODEL || OPENROUTER_MODEL,
    baseUrl: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL,
    apiKey,
    multimodal: true,
    reasoningEffort: normalizeOpenRouterReasoningEffort(process.env.OPENROUTER_REASONING_EFFORT),
    allowUnsafeLocalBaseUrl: true,
  };
}

/**
 * Resolve the effective LLM config for a user, gated by the addon.
 * Order: addon disabled → null; admin instance config wins; else per-user config;
 * else null. This is the single place the API key is decrypted.
 */
export function resolveLlmConfig(userId: number): ResolvedLlmConfig | null {
  if (!isAddonEnabled(ADDON_IDS.LLM_PARSING)) return null;
  return readInstanceConfig() ?? readUserConfig(userId) ?? readEnvConfig();
}

function isOpenRouterBase(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai';
  } catch {
    return false;
  }
}
