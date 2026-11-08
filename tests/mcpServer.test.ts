import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { BrowserSession, type WsLike } from '../src/browserSession.ts';
import { createMcpServer, PACKAGE_VERSION } from '../src/mcpServer.ts';
import { encode } from '../src/protocol.ts';

const TOOLS = [
  { name: 'cad_help', description: 'guide', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'view_screenshot', description: 'picture', inputSchema: { type: 'object' as const, properties: {} } },
];

/** A tab that answers each call through `reply`. */
function fakeTab(session: BrowserSession, reply: (name: string, input: unknown) => unknown) {
  const ws: WsLike = {
    isOpen: () => true,
    send: (data) => {
      const req = JSON.parse(data) as { id: string; name: string; input: unknown };
      queueMicrotask(() => session.handleFrame(encode({ id: req.id, ...(reply(req.name, req.input) as object) })));
    },
  };
  session.attach(ws);
  session.handleFrame(encode({ type: 'hello', contract: 3, tools: TOOLS }));
}

async function connectClient(session: BrowserSession, listToolsWaitMs = 0) {
  const { server } = createMcpServer(session, { listToolsWaitMs });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

describe('MCP server', () => {
  it('reports the package version and the usage instructions', async () => {
    const client = await connectClient(new BrowserSession());
    expect(client.getServerVersion()?.version).toBe(PACKAGE_VERSION);
    expect(client.getInstructions()).toMatch(/cad_help/);
  });

  it('lists the tools the tab advertised', async () => {
    const session = new BrowserSession();
    fakeTab(session, () => ({ ok: true, result: null }));
    const client = await connectClient(session);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['cad_help', 'view_screenshot']);
  });

  it('waits for a tab that connects shortly after the client lists tools', async () => {
    const session = new BrowserSession();
    const client = await connectClient(session, 2_000);
    const listing = client.listTools();
    setTimeout(() => fakeTab(session, () => ({ ok: true, result: null })), 50);
    expect((await listing).tools).toHaveLength(2);
  });

  it('notifies the client when the catalogue changes', async () => {
    const session = new BrowserSession();
    const client = await connectClient(session);
    let changed = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      changed++;
    });
    fakeTab(session, () => ({ ok: true, result: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(changed).toBeGreaterThan(0);
  });

  it('returns results as text, images as image content and refusals as errors', async () => {
    const session = new BrowserSession();
    fakeTab(session, (name, input) => {
      if (name === 'view_screenshot') return { ok: true, result: { kind: 'image', mimeType: 'image/jpeg', data: 'AAAA' } };
      if (name === 'cad_help') return { ok: true, result: { input } };
      return { ok: false, error: { code: 'UNKNOWN_TOOL', message: `There is no tool ${name}` } };
    });
    const client = await connectClient(session);

    const text = await client.callTool({ name: 'cad_help', arguments: { topic: 'x' } });
    expect(text.isError).toBeFalsy();
    expect(JSON.parse((text.content as { text: string }[])[0]!.text)).toEqual({ input: { topic: 'x' } });

    const image = await client.callTool({ name: 'view_screenshot', arguments: {} });
    expect(image.content).toEqual([{ type: 'image', mimeType: 'image/jpeg', data: 'AAAA' }]);

    const refused = await client.callTool({ name: 'nope', arguments: {} });
    expect(refused.isError).toBe(true);
    expect((refused.content as { text: string }[])[0]!.text).toBe('[UNKNOWN_TOOL] There is no tool nope');
  });

  it('answers a call with no tab connected as a tool error', async () => {
    const client = await connectClient(new BrowserSession());
    const res = await client.callTool({ name: 'cad_help', arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]!.text).toMatch(/no active browser session/);
  });
});
