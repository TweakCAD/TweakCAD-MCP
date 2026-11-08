import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { BridgeServer, isOriginAllowed, normalizeOrigin } from '../src/bridgeServer.ts';
import { BrowserSession } from '../src/browserSession.ts';
import { encode } from '../src/protocol.ts';

const servers: BridgeServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of servers.splice(0)) await s.stop();
});

async function startBridge(allowedOrigins: string[] = []): Promise<{ session: BrowserSession; port: number }> {
  const session = new BrowserSession();
  const bridge = new BridgeServer(session, { port: 0, allowedOrigins });
  await bridge.start();
  servers.push(bridge);
  const wss = (bridge as unknown as { wss: { address(): AddressInfo } }).wss;
  return { session, port: wss.address().port };
}

/** Opens a socket; resolves 'open' or the HTTP status of a refused handshake. */
function connect(port: number, origin?: string): Promise<{ ws: WebSocket; result: 'open' | number }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin === undefined ? {} : { origin });
  sockets.push(ws);
  return new Promise((resolve) => {
    ws.once('open', () => resolve({ ws, result: 'open' }));
    ws.once('unexpected-response', (_req, res) => resolve({ ws, result: res.statusCode ?? 0 }));
    ws.once('error', () => resolve({ ws, result: 0 }));
  });
}

describe('origin check', () => {
  it('allows the hosted app, loopback origins and listed origins only', () => {
    const extra = new Set(['https://cad.example.com']);
    expect(isOriginAllowed(undefined, extra)).toBe(true);
    expect(isOriginAllowed('https://tweakcad.com', extra)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', extra)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:8080', extra)).toBe(true);
    expect(isOriginAllowed('http://[::1]:3000', extra)).toBe(true);
    expect(isOriginAllowed('https://cad.example.com', extra)).toBe(true);
    expect(isOriginAllowed('https://evil.example', extra)).toBe(false);
    expect(isOriginAllowed('https://tweakcad.com.evil.example', extra)).toBe(false);
    expect(isOriginAllowed('http://tweakcad.com', extra)).toBe(false);
    expect(isOriginAllowed('null', extra)).toBe(false);
  });

  it('normalizes origins and rejects non-http ones', () => {
    expect(normalizeOrigin('https://CAD.example.com:443/')).toBe('https://cad.example.com');
    expect(normalizeOrigin('file:///x')).toBeNull();
    expect(normalizeOrigin('nonsense')).toBeNull();
  });
});

describe('BridgeServer', () => {
  it('refuses a page from another origin before the socket opens', async () => {
    const { port, session } = await startBridge();
    const { result } = await connect(port, 'https://evil.example');
    expect(result).toBe(403);
    expect(session.hasSession()).toBe(false);
  });

  it('accepts an origin passed in allowedOrigins', async () => {
    const { port } = await startBridge(['https://cad.example.com']);
    const { result } = await connect(port, 'https://cad.example.com');
    expect(result).toBe('open');
  });

  it('relays a call to the tab and its reply back', async () => {
    const { port, session } = await startBridge();
    const { ws, result } = await connect(port, 'https://tweakcad.com');
    expect(result).toBe('open');
    ws.on('message', (raw) => {
      const req = JSON.parse(String(raw)) as { id: string; name: string; input: unknown };
      ws.send(encode({ id: req.id, ok: true, result: { echoed: req.name, input: req.input } }));
    });
    ws.send(encode({ type: 'hello', contract: 3, tools: [{ name: 'cad_help', description: 'd', inputSchema: { type: 'object' } }] }));
    await session.waitForTools(1000);
    expect(session.getContract()).toBe(3);
    await expect(session.executeTool('cad_help', { a: 1 })).resolves.toMatchObject({ ok: true, result: { echoed: 'cad_help', input: { a: 1 } } });
  });

  it('refuses a second tab while one is attached, and takes it once the first leaves', async () => {
    const { port, session } = await startBridge();
    const first = await connect(port, 'http://localhost:5173');
    expect(first.result).toBe('open');
    const second = await connect(port, 'http://localhost:5173');
    expect(second.result).toBe(409);

    first.ws.close();
    await new Promise<void>((r) => first.ws.once('close', () => r()));
    for (let i = 0; i < 50 && session.hasSession(); i++) await new Promise((r) => setTimeout(r, 10));
    const third = await connect(port, 'http://localhost:5173');
    expect(third.result).toBe('open');
  });

  it('fails the calls in flight when the tab goes away', async () => {
    const { port, session } = await startBridge();
    const { ws } = await connect(port);
    const call = session.executeTool('feature_extrude', {});
    ws.terminate();
    await expect(call).rejects.toThrow(/went away before 'feature_extrude' replied/);
  });
});
