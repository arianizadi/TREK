import { Request } from 'express';
import { db } from '../db/database';
import fs from 'fs';
import path from 'path';

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 5;

const C = {
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  reset:   '\x1b[0m',
};

// ── File logger with rotation ─────────────────────────────────────────────

const logsDir = path.join(process.cwd(), 'data/logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
const logFilePath = path.join(logsDir, 'trek.log');

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(logFilePath)) return;
    const stat = fs.statSync(logFilePath);
    if (stat.size < MAX_LOG_SIZE) return;

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const src = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
      const dst = `${logFilePath}.${i}`;
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
  } catch {}
}

function writeToFile(line: string): void {
  try {
    rotateIfNeeded();
    fs.appendFileSync(logFilePath, line + '\n');
  } catch {}
}

// ── Public log helpers ────────────────────────────────────────────────────

function formatTs(): string {
  const tz = process.env.TZ || 'UTC';
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
}

function logInfo(msg: string): void {
  const ts = formatTs();
  console.log(`${C.blue}[INFO]${C.reset} ${ts} ${msg}`);
  writeToFile(`[INFO] ${ts} ${msg}`);
}

function logDebug(msg: string): void {
  if (LOG_LEVEL !== 'debug') return;
  const ts = formatTs();
  console.log(`${C.cyan}[DEBUG]${C.reset} ${ts} ${msg}`);
  writeToFile(`[DEBUG] ${ts} ${msg}`);
}

function logError(msg: string): void {
  const ts = formatTs();
  console.error(`${C.red}[ERROR]${C.reset} ${ts} ${msg}`);
  writeToFile(`[ERROR] ${ts} ${msg}`);
}

function logWarn(msg: string): void {
  const ts = formatTs();
  console.warn(`${C.yellow}[WARN]${C.reset} ${ts} ${msg}`);
  writeToFile(`[WARN] ${ts} ${msg}`);
}

// ── IP + audit ────────────────────────────────────────────────────────────

export function getClientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    return first || null;
  }
  if (Array.isArray(xff) && xff[0]) return String(xff[0]).trim() || null;
  return req.socket?.remoteAddress || null;
}

export interface AuditRequestContext {
  ip: string | null;
  countryCode: string | null;
  regionCode: string | null;
  regionName: string | null;
}

const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'cloudfront-viewer-country',
  'x-appengine-country',
  'fastly-geo-country-code',
  'x-country-code',
  'x-geo-country-code',
  'x-geo-country',
  'x-client-country',
  'x-ip-country',
];

const REGION_CODE_HEADERS = [
  'x-vercel-ip-country-region',
  'cloudfront-viewer-country-region',
  'x-appengine-region',
  'fastly-geo-region',
  'cf-region-code',
  'x-region-code',
  'x-geo-region-code',
  'x-geo-region',
  'x-client-region',
  'x-ip-region',
];

const REGION_NAME_HEADERS = [
  'cloudfront-viewer-country-region-name',
  'cf-region',
  'x-region-name',
  'x-geo-region-name',
  'x-vercel-ip-region',
];

const US_REGION_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function firstHeader(req: Request, names: string[]): string | null {
  for (const name of names) {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim()) {
      return safeDecode(value.split(',')[0]!.trim());
    }
  }
  return null;
}

function parseEdgescape(req: Request): Record<string, string> {
  const raw = req.headers['akamai-edgescape'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) return {};

  const fields: Record<string, string> = {};
  for (const part of value.split(',')) {
    const [key, ...rest] = part.split('=');
    const normalizedKey = key?.trim().toLowerCase();
    const normalizedValue = rest.join('=').trim();
    if (normalizedKey && normalizedValue) fields[normalizedKey] = safeDecode(normalizedValue);
  }
  return fields;
}

function normalizeCountryCode(value: string | null): string | null {
  const code = value?.trim().toUpperCase();
  if (!code || code === 'XX' || code === 'UNKNOWN') return null;
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function normalizeRegionCode(value: string | null, countryCode: string | null): string | null {
  const raw = value?.trim().toUpperCase().replace(/_/g, '-');
  if (!raw || raw === 'XX' || raw === 'UNKNOWN') return null;
  if (!/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(raw)) return null;
  if (countryCode && raw.startsWith(`${countryCode}-`)) return raw;
  if (countryCode && /^[A-Z0-9]{1,3}$/.test(raw)) return `${countryCode}-${raw}`;
  return raw;
}

function normalizeRegionName(value: string | null): string | null {
  const decoded = value?.trim();
  if (!decoded || decoded.toLowerCase() === 'unknown') return null;
  const normalized = decoded.replace(/[^\p{L}\p{N} ._'()-]/gu, '').trim();
  return normalized ? normalized.slice(0, 80) : null;
}

function regionNameFromCode(countryCode: string | null, regionCode: string | null): string | null {
  if (countryCode !== 'US' || !regionCode?.startsWith('US-')) return null;
  const stateCode = regionCode.slice(3);
  return US_REGION_NAMES[stateCode] ?? null;
}

export function getAuditRequestContext(req: Request): AuditRequestContext {
  const edgescape = parseEdgescape(req);
  const countryCode = normalizeCountryCode(
    firstHeader(req, COUNTRY_HEADERS) ?? edgescape.country_code ?? edgescape.country ?? null,
  );
  const regionCode = normalizeRegionCode(
    firstHeader(req, REGION_CODE_HEADERS) ?? edgescape.region_code ?? edgescape.region ?? edgescape.georegion ?? null,
    countryCode,
  );
  const explicitRegionName = normalizeRegionName(firstHeader(req, REGION_NAME_HEADERS) ?? edgescape.region_name ?? null);

  return {
    ip: getClientIp(req),
    countryCode,
    regionCode,
    regionName: explicitRegionName ?? regionNameFromCode(countryCode, regionCode),
  };
}

function resolveUserEmail(userId: number | null): string {
  if (!userId) return 'anonymous';
  try {
    const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
    return row?.email || `uid:${userId}`;
  } catch { return `uid:${userId}`; }
}

const ACTION_LABELS: Record<string, string> = {
  'user.register': 'registered',
  'user.login': 'logged in',
  'user.login_failed': 'login failed',
  'user.password_change': 'changed password',
  'user.account_delete': 'deleted account',
  'user.mfa_enable': 'enabled MFA',
  'user.mfa_disable': 'disabled MFA',
  'settings.app_update': 'updated settings',
  'trip.create': 'created trip',
  'trip.delete': 'deleted trip',
  'admin.user_role_change': 'changed user role',
  'admin.user_delete': 'deleted user',
  'admin.invite_create': 'created invite',
  'immich.private_ip_configured': 'configured Immich with private IP',
};

/** Best-effort; never throws — failures are logged only. */
export function writeAudit(entry: {
  userId: number | null;
  action: string;
  resource?: string | null;
  details?: Record<string, unknown>;
  debugDetails?: Record<string, unknown>;
  ip?: string | null;
  countryCode?: string | null;
  regionCode?: string | null;
  regionName?: string | null;
}): void {
  try {
    const detailsJson = entry.details && Object.keys(entry.details).length > 0 ? JSON.stringify(entry.details) : null;
    db.prepare(
      `INSERT INTO audit_log (user_id, action, resource, details, ip, country_code, region_code, region_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.userId,
      entry.action,
      entry.resource ?? null,
      detailsJson,
      entry.ip ?? null,
      entry.countryCode ?? null,
      entry.regionCode ?? null,
      entry.regionName ?? null,
    );

    const email = resolveUserEmail(entry.userId);
    const label = ACTION_LABELS[entry.action] || entry.action;
    const brief = buildInfoSummary(entry.action, entry.details);
    const location = formatAuditLocation(entry.countryCode ?? null, entry.regionCode ?? null, entry.regionName ?? null);
    logInfo(`${email} ${label}${brief} ip=${entry.ip || '-'}${location ? ` location=${location}` : ''}`);

    if (entry.debugDetails && Object.keys(entry.debugDetails).length > 0) {
      logDebug(`AUDIT ${entry.action} userId=${entry.userId} ${JSON.stringify(entry.debugDetails)}`);
    } else if (detailsJson) {
      logDebug(`AUDIT ${entry.action} userId=${entry.userId} ${detailsJson}`);
    }
  } catch (e) {
    logError(`Audit write failed: ${e instanceof Error ? e.message : e}`);
  }
}

function formatAuditLocation(countryCode: string | null, regionCode: string | null, regionName: string | null): string | null {
  if (regionName && countryCode) return `${regionName},${countryCode}`;
  if (regionCode && countryCode) return `${regionCode},${countryCode}`;
  return countryCode || regionName || regionCode || null;
}

function buildInfoSummary(action: string, details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '';
  if (action === 'trip.create') return ` "${details.title}"`;
  if (action === 'trip.delete') return ` tripId=${details.tripId}`;
  if (action === 'user.register') return ` ${details.email}`;
  if (action === 'user.login') return '';
  if (action === 'user.login_failed') return ` reason=${details.reason}`;
  if (action === 'settings.app_update') {
    const parts: string[] = [];
    if (details.notification_channel) parts.push(`channel=${details.notification_channel}`);
    if (details.smtp_settings_updated) parts.push('smtp');
    if (details.notification_events_updated) parts.push('events');
    if (details.webhook_url_updated) parts.push('webhook_url');
    if (details.allowed_file_types_updated) parts.push('file_types');
    if (details.allow_registration !== undefined) parts.push(`registration=${details.allow_registration}`);
    if (details.require_mfa !== undefined) parts.push(`mfa=${details.require_mfa}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }
  if (action === 'immich.private_ip_configured') {
    return details.resolved_ip ? ` url=${details.immich_url} ip=${details.resolved_ip}` : '';
  }
  return '';
}

export { LOG_LEVEL, logInfo, logDebug, logError, logWarn };
