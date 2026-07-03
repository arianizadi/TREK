import {
  KNOWN_METHODS,
  type KnownMethod,
  type RpcError,
  type RpcRequest,
  type RpcResponse,
} from '../protocol/envelope';
import type { PluginDataDb } from './plugin-data.service';

/**
 * The per-plugin capability router (#plugins, M1) — the ENFORCEMENT POINT.
 *
 * Built from the plugin's GRANTED permission set. Only the methods a permission
 * unlocks are registered; an ungranted method is simply never in the map, so the
 * plugin cannot "call it anyway" — there is no shared object, only messages, and
 * the host is the sole holder of the trek.db handle and the broadcast fns.
 *
 * Runs in the HOST (parent) process.
 */

/** Thrown by a handler when the acting user may not touch the requested resource. */
export class ForbiddenResource extends Error {}

interface CoreDb {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
}

export interface HostDeps {
  /** The plugin's own sqlite (db:own). */
  data: PluginDataDb;
  /** Read-only handle to the core trek.db, used ONLY through the typed readers here. */
  db: CoreDb;
  /** Returns the trip row if the user may access it, else undefined. */
  canAccessTrip(tripId: number, userId: number): unknown;
  /** Namespaced trip broadcast (host forces the plugin:{id}:{event} event type). */
  broadcastToTrip(tripId: number, eventType: string, payload: Record<string, unknown>): void;
  /** Namespaced per-user broadcast. */
  broadcastToUser(userId: number, payload: Record<string, unknown>): void;
}

type Handler = (params: Record<string, unknown>) => unknown;

const num = (v: unknown, name: string): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new BadParams(`${name} must be a number`);
  return n;
};
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new BadParams(`${name} must be a string`);
  return v;
};
class BadParams extends Error {}

export class PluginRpcHost {
  private methods = new Map<string, Handler>();

  constructor(
    private readonly pluginId: string,
    granted: ReadonlySet<string>,
    private readonly deps: HostDeps,
  ) {
    const has = (p: string) => granted.has(p);

    if (has('db:own')) {
      this.methods.set('db.query', (p) => deps.data.query(str(p.sql, 'sql'), asArgs(p.args)));
      this.methods.set('db.exec', (p) => deps.data.exec(str(p.sql, 'sql'), asArgs(p.args)));
      this.methods.set('db.migrate', (p) => deps.data.migrate(str(p.id, 'id'), str(p.sql, 'sql')));
    }

    if (has('db:read:trips')) {
      this.methods.set('trips.getById', (p) =>
        this.tripRead(p, () => deps.db.prepare('SELECT * FROM trips WHERE id = ?').get(num(p.tripId, 'tripId'))),
      );
      this.methods.set('trips.getPlaces', (p) =>
        this.tripRead(p, () => deps.db.prepare('SELECT * FROM places WHERE trip_id = ? ORDER BY day_id, position').all(num(p.tripId, 'tripId'))),
      );
      this.methods.set('trips.getReservations', (p) =>
        this.tripRead(p, () => deps.db.prepare('SELECT * FROM reservations WHERE trip_id = ? ORDER BY reservation_time').all(num(p.tripId, 'tripId'))),
      );
    }

    if (has('db:read:users')) {
      this.methods.set('users.getById', (p) =>
        deps.db
          .prepare('SELECT id, username, display_name, avatar FROM users WHERE id = ?')
          .get(num(p.id, 'id')),
      );
    }

    if (has('ws:broadcast:trip')) {
      this.methods.set('ws.broadcastToTrip', (p) => {
        deps.broadcastToTrip(num(p.tripId, 'tripId'), str(p.event, 'event'), asPayload(p.data));
        return { ok: true };
      });
    }
    if (has('ws:broadcast:user')) {
      this.methods.set('ws.broadcastToUser', (p) => {
        deps.broadcastToUser(num(p.userId, 'userId'), { event: str(p.event, 'event'), ...asPayload(p.data) });
        return { ok: true };
      });
    }
  }

  /** Membership-check every trip read against the acting user; forbid otherwise. */
  private tripRead(p: Record<string, unknown>, read: () => unknown): unknown {
    const tripId = num(p.tripId, 'tripId');
    const asUserId = num(p.asUserId, 'asUserId');
    if (!this.deps.canAccessTrip(tripId, asUserId)) {
      throw new ForbiddenResource(`no access to trip ${tripId}`);
    }
    return read();
  }

  async dispatch(req: RpcRequest): Promise<RpcResponse | RpcError> {
    const handler = this.methods.get(req.method);
    if (!handler) {
      const known = (KNOWN_METHODS as readonly string[]).includes(req.method as KnownMethod);
      return this.err(
        req.id,
        known ? 'PERMISSION_DENIED' : 'UNKNOWN_METHOD',
        known
          ? `${req.method} requires a permission "${this.pluginId}" was not granted`
          : `unknown method ${req.method}`,
      );
    }
    const params = (req.params ?? {}) as Record<string, unknown>;
    try {
      const result = await handler(params);
      return { k: 'res', id: req.id, ok: true, result };
    } catch (e) {
      if (e instanceof BadParams) return this.err(req.id, 'BAD_PARAMS', e.message);
      if (e instanceof ForbiddenResource) return this.err(req.id, 'RESOURCE_FORBIDDEN', e.message);
      return this.err(req.id, 'HOST_ERROR', e instanceof Error ? e.message : 'internal error');
    }
  }

  private err(id: string, code: RpcError['error']['code'], message: string): RpcError {
    return { k: 'res', id, ok: false, error: { code, message } };
  }

  /** Release host-held resources (the plugin's own db handle) on terminal stop. */
  dispose(): void {
    try {
      this.deps.data.close();
    } catch {
      /* already closed */
    }
  }
}

function asArgs(v: unknown): unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  throw new BadParams('args must be an array');
}
function asPayload(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v };
}
