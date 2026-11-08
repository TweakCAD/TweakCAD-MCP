/**
 * Library entry point — re-exports the bridge surface for tests and any
 * programmatic embedding. End users invoke the CLI (`tweakcad-mcp`).
 */

export {
  BridgeServer,
  HOSTED_APP_ORIGIN,
  isOriginAllowed,
  normalizeOrigin,
  type BridgeServerOptions,
} from './bridgeServer.ts';
export {
  BrowserSession,
  DEFAULT_REQUEST_TIMEOUT_MS,
  NO_SESSION_MESSAGE,
  type BrowserSessionOptions,
  type WsLike,
} from './browserSession.ts';
export { createMcpServer, LIST_TOOLS_WAIT_MS, PACKAGE_VERSION, type McpServerOptions } from './mcpServer.ts';
export type {
  ExecuteToolRequest,
  ToolResponse,
  ToolResponseOk,
  ToolResponseErr,
  HelloEvent,
  McpToolDescriptor,
} from './protocol.ts';
export { encode, decode, isToolResponse, isHelloEvent } from './protocol.ts';
