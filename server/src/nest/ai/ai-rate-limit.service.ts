import { HttpException, Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  first: number;
}

@Injectable()
export class AiRateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  private readonly active = new Map<string, number>();

  assertAllowed(kind: 'chat' | 'preview' | 'apply' | 'undo' | 'test', userId: number, tripId?: string | number, ip?: string): void {
    const cfg = LIMITS[kind];
    this.cleanup(Date.now());
    this.hit(`${kind}:user:${userId}:${tripId ?? 'global'}`, cfg);
    if (ip) this.hit(`${kind}:ip:${ip}:${tripId ?? 'global'}`, cfg);
  }

  enterStream(userId: number, tripId: string | number, ip?: string): () => void {
    const keys = [`chat:active:user:${userId}`, `chat:active:trip:${tripId}`];
    if (ip) keys.push(`chat:active:ip:${ip}`);
    for (const key of keys) {
      if ((this.active.get(key) ?? 0) >= ACTIVE_CHAT_LIMIT) {
        throw new HttpException({ error: 'Too many active AI streams. Please try again shortly.' }, 429);
      }
    }
    for (const key of keys) this.active.set(key, (this.active.get(key) ?? 0) + 1);
    return () => {
      for (const key of keys) {
        const next = (this.active.get(key) ?? 1) - 1;
        if (next <= 0) this.active.delete(key);
        else this.active.set(key, next);
      }
    };
  }

  private hit(key: string, cfg: { max: number; windowMs: number }): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.first >= cfg.windowMs) {
      this.buckets.set(key, { count: 1, first: now });
      return;
    }
    if (bucket.count >= cfg.max) {
      throw new HttpException({ error: 'Too many AI requests. Please try again later.' }, 429);
    }
    bucket.count++;
  }

  private cleanup(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.first > MAX_WINDOW_MS) this.buckets.delete(key);
    }
  }
}

const LIMITS = {
  chat: { max: 30, windowMs: 15 * 60_000 },
  preview: { max: 20, windowMs: 15 * 60_000 },
  apply: { max: 30, windowMs: 15 * 60_000 },
  undo: { max: 30, windowMs: 15 * 60_000 },
  test: { max: 10, windowMs: 15 * 60_000 },
} as const;
const MAX_WINDOW_MS = Math.max(...Object.values(LIMITS).map(l => l.windowMs));
const ACTIVE_CHAT_LIMIT = 2;
