import { describe, it, expect, vi } from 'vitest';

// Prevent file I/O side effects at module load time
vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ size: 0 })),
    appendFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => ({ size: 0 })),
  appendFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock('../../../src/db/database', () => ({
  db: { prepare: () => ({ get: vi.fn(), run: vi.fn() }) },
}));

import { getAuditRequestContext, getClientIp } from '../../../src/services/auditLog';
import type { Request } from 'express';

function makeReq(options: {
  xff?: string | string[];
  remoteAddress?: string;
  headers?: Record<string, string | string[]>;
} = {}): Request {
  return {
    headers: {
      ...(options.xff !== undefined ? { 'x-forwarded-for': options.xff } : {}),
      ...(options.headers ?? {}),
    },
    socket: { remoteAddress: options.remoteAddress ?? undefined },
  } as unknown as Request;
}

describe('getClientIp', () => {
  it('returns first IP from comma-separated X-Forwarded-For string', () => {
    expect(getClientIp(makeReq({ xff: '1.2.3.4, 5.6.7.8, 9.10.11.12' }))).toBe('1.2.3.4');
  });

  it('returns single IP when X-Forwarded-For has no comma', () => {
    expect(getClientIp(makeReq({ xff: '10.0.0.1' }))).toBe('10.0.0.1');
  });

  it('returns first element when X-Forwarded-For is an array', () => {
    expect(getClientIp(makeReq({ xff: ['203.0.113.1', '10.0.0.1'] }))).toBe('203.0.113.1');
  });

  it('trims whitespace from extracted IP', () => {
    expect(getClientIp(makeReq({ xff: '  192.168.1.1  , 10.0.0.1' }))).toBe('192.168.1.1');
  });

  it('falls back to req.socket.remoteAddress when no X-Forwarded-For', () => {
    expect(getClientIp(makeReq({ remoteAddress: '172.16.0.1' }))).toBe('172.16.0.1');
  });

  it('returns null when no forwarded header and no socket address', () => {
    expect(getClientIp(makeReq({}))).toBeNull();
  });

  it('returns null for empty string X-Forwarded-For', () => {
    const req = {
      headers: { 'x-forwarded-for': '' },
      socket: { remoteAddress: undefined },
    } as unknown as Request;
    expect(getClientIp(req)).toBeNull();
  });
});

describe('getAuditRequestContext', () => {
  it('returns normalized country and US state from proxy geo headers', () => {
    expect(
      getAuditRequestContext(makeReq({
        xff: '203.0.113.4',
        headers: {
          'x-vercel-ip-country': 'us',
          'x-vercel-ip-country-region': 'ca',
        },
      })),
    ).toEqual({
      ip: '203.0.113.4',
      countryCode: 'US',
      regionCode: 'US-CA',
      regionName: 'California',
    });
  });

  it('uses explicit region names when a proxy provides them', () => {
    expect(
      getAuditRequestContext(makeReq({
        remoteAddress: '198.51.100.2',
        headers: {
          'cloudfront-viewer-country': 'US',
          'cloudfront-viewer-country-region': 'NY',
          'cloudfront-viewer-country-region-name': 'New%20York',
        },
      })),
    ).toEqual({
      ip: '198.51.100.2',
      countryCode: 'US',
      regionCode: 'US-NY',
      regionName: 'New York',
    });
  });

  it('leaves geo fields null when no geo headers are present', () => {
    expect(getAuditRequestContext(makeReq({ remoteAddress: '10.0.0.2' }))).toEqual({
      ip: '10.0.0.2',
      countryCode: null,
      regionCode: null,
      regionName: null,
    });
  });
});
