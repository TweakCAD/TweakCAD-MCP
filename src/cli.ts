#!/usr/bin/env node
/**
 * tweakcad-mcp CLI entrypoint.
 *
 * Starts:
 *   - a WebSocket server on --port (default 7788), single-session.
 *   - an MCP stdio server. The bridge is a pure relay: tool calls are
 *     forwarded to the connected browser, which runs them against the
 *     live editor and replies. The browser advertises its tool catalogue
 *     on connect.
 *
 * MCP traffic flows over stdio (stdin = client -> server, stdout =
 * server -> client). Everything human-readable goes to STDERR so we
 * never corrupt the stdio protocol.
 */

import { BridgeServer, HOSTED_APP_ORIGIN, normalizeOrigin } from './bridgeServer.ts';
import { BrowserSession, DEFAULT_REQUEST_TIMEOUT_MS } from './browserSession.ts';
import { createMcpServer, PACKAGE_VERSION } from './mcpServer.ts';

const DEFAULT_PORT = 7788;

type Args = {
  port: number;
  timeoutSeconds: number;
  allowedOrigins: string[];
  help: boolean;
  version: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    port: DEFAULT_PORT,
    timeoutSeconds: DEFAULT_REQUEST_TIMEOUT_MS / 1000,
    allowedOrigins: [],
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a === '--version' || a === '-v') {
      args.version = true;
      continue;
    }
    // Options with a value: `--name value` or `--name=value`.
    const eq = a.indexOf('=');
    const flag = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    let value: string | undefined;
    if (flag !== a) {
      value = a.slice(eq + 1);
    } else if (['--port', '-p', '--timeout', '--allow-origin'].includes(a)) {
      value = argv[i + 1];
      if (value === undefined) throw new Error(`${a} requires a value`);
      i++;
    }
    if (flag === '--port' || flag === '-p') {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new Error(`invalid port: ${String(value)}`);
      args.port = n;
    } else if (flag === '--timeout') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid timeout: ${String(value)}`);
      args.timeoutSeconds = n;
    } else if (flag === '--allow-origin') {
      if (value === undefined || normalizeOrigin(value) === null) throw new Error(`invalid origin: ${String(value)}`);
      args.allowedOrigins.push(value);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

const USAGE = `tweakcad-mcp: MCP relay for TweakCAD

USAGE
  tweakcad-mcp [--port <number>] [--timeout <seconds>] [--allow-origin <origin>]...

OPTIONS
  --port, -p <number>      WebSocket bridge port (default ${DEFAULT_PORT})
  --timeout <seconds>      How long a tool call waits for the app (default ${DEFAULT_REQUEST_TIMEOUT_MS / 1000})
  --allow-origin <origin>  Also accept the app from this origin, e.g. a
                           self-hosted https://cad.example.com (repeatable).
                           ${HOSTED_APP_ORIGIN} and localhost are always accepted.
  --version, -v            Print the version
  --help, -h               Show this message

The bridge speaks MCP on stdio to an MCP client and relays tool calls to
the running TweakCAD web app over WebSocket. Open the app and turn on the
AI bridge in Settings, AI to connect.
`;

function log(line: string): void {
  // Never write to stdout — that channel belongs to MCP.
  process.stderr.write(`[tweakcad-mcp] ${line}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    process.stderr.write(USAGE);
    return 2;
  }

  if (parsed.help) {
    process.stderr.write(USAGE);
    return 0;
  }
  if (parsed.version) {
    process.stderr.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  const host = new BrowserSession({
    requestTimeoutMs: parsed.timeoutSeconds * 1000,
    onHello: (contract, toolCount) =>
      log(`app announced ${toolCount} tools, tool contract ${contract ?? 'unversioned'}`),
  });
  const bridge = new BridgeServer(host, {
    port: parsed.port,
    allowedOrigins: parsed.allowedOrigins,
    log,
    onSessionChange: (n) => {
      if (n === 0) log('waiting for browser session...');
    },
  });

  try {
    await bridge.start();
  } catch (e) {
    log(`failed to start WebSocket bridge: ${e instanceof Error ? e.message : String(e)}`);
    if ((e as { code?: unknown }).code === 'EADDRINUSE') {
      log(
        `port ${parsed.port} is taken, most likely by a bridge another MCP client started; ` +
          'only one bridge can serve the app at a time. Close the other client, or give this one ' +
          'another --port and set the same port in the app (Settings, AI).',
      );
    }
    return 1;
  }
  log(`WebSocket bridge listening on ws://127.0.0.1:${parsed.port}`);
  log('waiting for browser session...');

  const { connectStdio } = createMcpServer(host);
  try {
    await connectStdio();
  } catch (e) {
    log(`failed to start MCP stdio server: ${e instanceof Error ? e.message : String(e)}`);
    await bridge.stop();
    return 1;
  }
  log('MCP server ready on stdio');

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${signal})`);
    bridge
      .stop()
      .catch((e) => log(`shutdown error: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        process.exit(0);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // A client that exits closes our stdin; without this the bridge would
  // live on and keep the port, and the next start would fail.
  process.stdin.on('end', () => shutdown('stdin closed'));
  process.stdin.on('close', () => shutdown('stdin closed'));

  // Keep the process alive; stdio + ws both hold event-loop refs.
  return await new Promise<number>(() => {
    /* never resolves — exit via signal handler */
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err) => {
    process.stderr.write(`[tweakcad-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
