/**
 * WebSocket server that accepts a single browser session and routes
 * its frames into the shared `BrowserSession`.
 *
 * Who may connect
 * ---------------
 * A browser sends an `Origin` header with every WebSocket handshake, and
 * any page the user has open could try to reach a loopback port. The
 * handshake is refused (HTTP 403) unless the origin is the hosted app,
 * a loopback origin (a local or self-hosted app), or one passed in
 * `allowedOrigins`. A handshake without an `Origin` comes from a local
 * program, not a page, and is accepted.
 *
 * Single-session policy
 * ---------------------
 * Only one browser may be connected at a time. A second handshake while
 * one is attached is refused (HTTP 409) before the socket opens, so the
 * second tab sees a failed connection and backs off. Multi-session relay
 * would require keying relayed calls by session id.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { BrowserSession, WsLike } from './browserSession.ts';

/** The hosted app's origin, always allowed. */
export const HOSTED_APP_ORIGIN = 'https://tweakcad.com';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface BridgeServerOptions {
  /** TCP port to listen on. */
  port: number;
  /** Bind host. Default: 127.0.0.1 (loopback only). */
  host?: string;
  /** Origins allowed besides the hosted app and loopback origins, e.g. `https://cad.example.com`. */
  allowedOrigins?: readonly string[];
  /** Called whenever the session count transitions 0->1 or 1->0. */
  onSessionChange?: (sessions: number) => void;
  /** Optional sink for human-readable status lines. */
  log?: (line: string) => void;
}

const NOOP_LOG = (_line: string): void => {
  /* swallowed */
};

/** `scheme://host[:port]` of a URL, or null when it is not an http(s) URL. */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Whether a page of `origin` may connect, given the extra allowed origins (normalized). */
export function isOriginAllowed(origin: string | undefined, extra: ReadonlySet<string>): boolean {
  if (origin === undefined) return true;
  const o = normalizeOrigin(origin);
  if (o === null) return false;
  if (o === HOSTED_APP_ORIGIN || extra.has(o)) return true;
  return LOOPBACK_HOSTS.has(new URL(o).hostname);
}

/**
 * Wrap a `ws.WebSocket` as the WsLike duck-type expected by BrowserSession.
 */
function adapt(ws: WebSocket): WsLike {
  return {
    send: (data) => ws.send(data),
    isOpen: () => ws.readyState === ws.OPEN,
  };
}

export class BridgeServer {
  private readonly opts: Required<Omit<BridgeServerOptions, 'onSessionChange' | 'host' | 'allowedOrigins'>> &
    Pick<BridgeServerOptions, 'onSessionChange' | 'host'>;
  private readonly extraOrigins: ReadonlySet<string>;
  private wss: WebSocketServer | null = null;
  private active: WebSocket | null = null;
  private readonly host: BrowserSession;

  constructor(host: BrowserSession, opts: BridgeServerOptions) {
    this.host = host;
    this.opts = {
      port: opts.port,
      log: opts.log ?? NOOP_LOG,
      ...(opts.host !== undefined ? { host: opts.host } : {}),
      ...(opts.onSessionChange !== undefined
        ? { onSessionChange: opts.onSessionChange }
        : {}),
    };
    const extra = new Set<string>();
    for (const o of opts.allowedOrigins ?? []) {
      const n = normalizeOrigin(o);
      if (n === null) throw new Error(`invalid origin: ${o}`);
      extra.add(n);
    }
    this.extraOrigins = extra;
  }

  /** Start listening. Resolves once the server is bound. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        port: this.opts.port,
        host: this.opts.host ?? '127.0.0.1',
        verifyClient: (info: { origin: string; req: IncomingMessage }, cb: (ok: boolean, code?: number, message?: string) => void) =>
          this.verify(info, cb),
      });

      const onListening = (): void => {
        wss.off('error', onError);
        resolve();
      };
      const onError = (err: Error): void => {
        wss.off('listening', onListening);
        reject(err);
      };
      wss.once('listening', onListening);
      wss.once('error', onError);

      wss.on('connection', (ws) => this.onConnection(ws));
      this.wss = wss;
    });
  }

  /** Stop accepting connections and close the active session, if any. */
  async stop(): Promise<void> {
    const wss = this.wss;
    this.wss = null;
    if (this.active !== null) {
      try {
        this.active.close(1001, 'bridge shutting down');
      } catch {
        /* ignore */
      }
      this.active = null;
      this.host.detach('bridge shutting down');
      this.opts.onSessionChange?.(0);
    }
    if (wss === null) return;
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  private verify(
    info: { origin: string; req: IncomingMessage },
    cb: (ok: boolean, code?: number, message?: string) => void,
  ): void {
    // `info.origin` is the header value; it is absent for non-browser clients.
    const origin = info.req.headers.origin;
    if (!isOriginAllowed(origin, this.extraOrigins)) {
      this.opts.log(`refusing connection from origin ${String(origin)} (allow it with --allow-origin)`);
      cb(false, 403, 'origin not allowed');
      return;
    }
    if (this.active !== null) {
      this.opts.log('refusing connection: another browser is already attached');
      cb(false, 409, 'another browser is already attached');
      return;
    }
    cb(true);
  }

  private onConnection(ws: WebSocket): void {
    // Two handshakes verified at the same moment: the later one is closed.
    if (this.active !== null) {
      this.opts.log('refusing connection: another browser is already attached');
      try {
        ws.close(1013, 'another browser is already attached');
      } catch {
        /* ignore */
      }
      return;
    }

    this.active = ws;
    this.host.attach(adapt(ws));
    this.opts.log('browser connected (1 active session)');
    this.opts.onSessionChange?.(1);

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      this.host.handleFrame(text);
    });

    const teardown = (reason: string): void => {
      if (this.active !== ws) return;
      this.active = null;
      this.host.detach(reason);
      this.opts.log(`browser disconnected (${reason}); 0 active sessions`);
      this.opts.onSessionChange?.(0);
    };

    ws.on('close', () => teardown('socket closed'));
    ws.on('error', (err) => {
      this.opts.log(`socket error: ${err.message}`);
      teardown(`socket error: ${err.message}`);
    });
  }
}
