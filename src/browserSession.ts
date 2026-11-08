/**
 * BrowserSession — the bridge's view of the one connected browser tab.
 *
 * Pure relay: this holds NO document cache and runs NO tool logic. It
 * (1) forwards `executeTool` requests to the browser and correlates the
 * replies by id, and (2) keeps the latest tool catalogue the browser
 * advertised via `hello`, so the MCP server can answer ListTools.
 */

import {
  encode,
  decode,
  isToolResponse,
  isHelloEvent,
  type ExecuteToolRequest,
  type ToolResponse,
  type McpToolDescriptor,
} from './protocol.ts';

/** Minimal duck-typed WebSocket (the subset both `ws` and tests provide). */
export interface WsLike {
  send(data: string): void;
  /** `true` if the socket is open and `send` is safe to call. */
  isOpen(): boolean;
}

export const NO_SESSION_MESSAGE =
  'no active browser session — open TweakCAD and enable the AI bridge in Settings → AI.';

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** What a caller is told when a call got no answer: the tab may still have applied it. */
const MAY_HAVE_RUN = 'the app may still have applied it; check with list_features or get_diagnostics before running it again.';

type Pending = {
  name: string;
  resolve: (r: ToolResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface BrowserSessionOptions {
  /** Override the per-call round-trip timeout (ms). Default: 60 000. */
  requestTimeoutMs?: number;
  /** Called on each `hello`, with the contract it carries (null when none) and its tool count. */
  onHello?: (contract: number | null, toolCount: number) => void;
}

export class BrowserSession {
  private socket: WsLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;
  private readonly onHello: ((contract: number | null, toolCount: number) => void) | null;
  private tools: McpToolDescriptor[] = [];
  private contract: number | null = null;
  private toolWaiters: (() => void)[] = [];

  /**
   * Fired when the advertised tool catalogue changes (browser connect with
   * `hello`, or disconnect → empty). The MCP server wires this to
   * `tools/list_changed` so MCP clients re-fetch ListTools.
   */
  onToolsChanged: (() => void) | null = null;

  constructor(opts: BrowserSessionOptions = {}) {
    this.timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.onHello = opts.onHello ?? null;
  }

  // --- Lifecycle ------------------------------------------------------------

  attach(socket: WsLike): void {
    this.socket = socket;
  }

  /** Drop the socket: reject in-flight calls and clear the catalogue. */
  detach(reason = 'browser disconnected'): void {
    this.socket = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(`the TweakCAD tab went away before '${p.name}' replied (${reason}); ${MAY_HAVE_RUN}`));
    }
    this.pending.clear();
    this.contract = null;
    if (this.tools.length > 0) {
      this.tools = [];
      this.onToolsChanged?.();
    }
  }

  hasSession(): boolean {
    return this.socket !== null && this.socket.isOpen();
  }

  /** The tool catalogue version the browser last advertised, or null (no session, or an app that sends none). */
  getContract(): number | null {
    return this.contract;
  }

  /** The tools the browser last advertised (empty when no session). */
  getTools(): McpToolDescriptor[] {
    return this.tools;
  }

  /**
   * Resolves once a browser has advertised tools, or after `ms`, whichever
   * comes first. Resolves at once when tools are already known.
   */
  waitForTools(ms: number): Promise<void> {
    if (this.tools.length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.toolWaiters = this.toolWaiters.filter((w) => w !== done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.toolWaiters.push(done);
    });
  }

  /** Feed a raw text frame: a tool response (resolve) or a hello (catalogue). */
  handleFrame(text: string): void {
    const parsed = decode(text);
    if (parsed === undefined) return;

    if (isToolResponse(parsed)) {
      const p = this.pending.get(parsed.id);
      if (!p) return; // late / duplicate
      this.pending.delete(parsed.id);
      clearTimeout(p.timer);
      p.resolve(parsed);
      return;
    }

    if (isHelloEvent(parsed)) {
      this.tools = parsed.tools;
      this.contract = typeof parsed.contract === 'number' ? parsed.contract : null;
      this.onHello?.(this.contract, this.tools.length);
      this.onToolsChanged?.();
      if (this.tools.length > 0) for (const w of [...this.toolWaiters]) w();
    }
  }

  // --- Relay ----------------------------------------------------------------

  /**
   * Forward a tool call to the browser and await its reply. Rejects if no
   * browser is connected or the round-trip times out.
   */
  executeTool(name: string, input: unknown): Promise<ToolResponse> {
    const sock = this.socket;
    if (sock === null || !sock.isOpen()) {
      return Promise.reject(new Error(NO_SESSION_MESSAGE));
    }
    const id = `r${this.nextId++}`;
    const req: ExecuteToolRequest = { id, type: 'executeTool', name, input };
    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`tool '${name}' timed out after ${this.timeoutMs / 1000}s without a reply; ${MAY_HAVE_RUN}`));
      }, this.timeoutMs);
      this.pending.set(id, { name, resolve, reject, timer });
      try {
        sock.send(encode(req));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}
