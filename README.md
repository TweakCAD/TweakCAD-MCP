# @tweakcad/mcp-bridge

A small Node CLI that relays Model Context Protocol (MCP) traffic between
**any MCP-capable client** and a running TweakCAD web app. MCP is a generic
protocol, so the same bridge works with Claude Desktop, Claude Code, Cursor,
Windsurf, VS Code (Copilot agent mode), Zed, Cline, Gemini CLI, OpenAI Codex,
JetBrains AI Assistant, and any other client that speaks MCP.

The bridge speaks MCP over stdio and WebSocket (`ws://127.0.0.1:7788` by
default) to the browser tab.

```
+----------------+        stdio (MCP)         +-----------------+        ws (JSON)         +----------------+
|  MCP client    | <------------------------> |  tweakcad-mcp   | <----------------------> |  CAD web app   |
+----------------+                            +-----------------+                          +----------------+
```

The bridge itself holds **no document state** and runs no tool logic: every
tool call is forwarded to the browser tab, which runs it against the open
document and replies. The tab also sends the tool list on connect, so the
bridge lists exactly the tools the running app has.

## Install / run

Published to npm, so most clients can run it without a checkout:

```bash
npx @tweakcad/mcp-bridge           # listens on ws://127.0.0.1:7788
```

From a clone of this repo (Node 24, `corepack enable` for pnpm):

```bash
pnpm install
pnpm build
pnpm start                         # listens on ws://127.0.0.1:7788
```

CLI options:

```
tweakcad-mcp [--port <number>]
  --port, -p <number>   WebSocket bridge port (default 7788)
  --help, -h            Show usage
```

Exit with `Ctrl-C`; the bridge closes the WebSocket cleanly and exits 0.

## Register with your MCP client

The bridge presents itself as a standard MCP stdio server: a client launches
`node .../dist/cli.js` and talks to it over stdio. Almost every client uses
the same `mcpServers` JSON object and differs only in **where** that config
lives; a few use a different key or file format. Find your client below and
adjust the absolute path to the built `dist/cli.js`.

### Clients using the standard `mcpServers` JSON

Claude Desktop, Claude Code, Cursor, Windsurf, Cline, Gemini CLI, and most
others accept this exact object — drop it into the file listed in the table:

```json
{
  "mcpServers": {
    "tweakcad": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"]
    }
  }
}
```

| Client | Config file |
|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Windows) — restart after editing |
| Claude Code | project `.mcp.json` (or run `claude mcp add tweakcad -- node /abs/path/dist/cli.js`) |
| Cursor | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline (VS Code ext.) | `cline_mcp_settings.json` (via the extension's MCP settings) |
| Gemini CLI | `~/.gemini/settings.json` |
| JetBrains AI Assistant | IDE Settings → Tools → AI Assistant → MCP (same JSON shape) |

### VS Code (Copilot agent mode)

VS Code uses a `servers` key (not `mcpServers`). Add to `.vscode/mcp.json`
in your workspace:

```json
{
  "servers": {
    "tweakcad": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"]
    }
  }
}
```

### OpenAI Codex CLI

Codex reads `~/.codex/config.toml`; MCP servers live under the `mcp_servers`
table:

```toml
[mcp_servers.tweakcad]
command = "node"
args = ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"]
```

### Zed

Zed calls them `context_servers` in `settings.json`:

```json
{
  "context_servers": {
    "tweakcad": {
      "command": { "path": "node", "args": ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"] }
    }
  }
}
```

### Once the package is published

You can skip the absolute path and use the `tweakcad-mcp` command directly —
e.g. for the standard `mcpServers` shape:

```json
{
  "mcpServers": {
    "tweakcad": {
      "command": "tweakcad-mcp",
      "args": ["--port", "7788"]
    }
  }
}
```

## Enable the bridge in the CAD app

Open the CAD app, click the **Settings** icon (top-right), and toggle
**Enable AI bridge** in the AI tab. Set host/port to match the bridge
process (default `localhost:7788`).

A small dot appears next to the Settings icon showing the connection
state — yellow while connecting, green when the bridge is reachable,
red on error. Hover for the URL and last error message; click to jump
back into Settings.

The browser opens a WebSocket to the bridge, sends its tool list and starts
answering tool calls, one at a time in the order they arrive. Edits from the
MCP client go through the same editor commands the app's own tools use, so a
refused edit says why in the same words. Undo groups a client opens with
`begin_transaction` and leaves open are closed when it disconnects.

## Tool surface

The tools are the app's tool catalogue, **contract version 3** (the
`contract` field of the browser's `hello` frame; 3 changed `assembly_insert`,
whose `assembly` is now only the destination, with `subassembly` for placing
another assembly). It works on the version-2
document format: parts with a timeline of features, value objects bound to
expressions, sketch rows. Bodies, faces, edges, vertices, sketch regions,
curves and points are listed with **handles** (`b:1`, `f:4`, `e:7`, `r:2`);
feature tools take handles and the app writes each reference by picking the
entity, so a handle keeps naming its entity after later edits. Call
`cad_help` first: it returns the workflow guide.

Version 1 of the contract (`get_document` returning the old document,
`dispatch_command`, stable face and edge ids, `wait_for_rebuild`) is gone;
a bridge from 0.1 relays the new tools unchanged, but clients and prompts
written for the old names need updating.

| Tools | What they do |
|---|---|
| `cad_help` | The workflow guide: document model, handles, coordinates, examples, what fails. |
| `get_document` / `list_features` / `get_diagnostics` | The document as stored, an outline with each feature's status, and what the newest rebuild paused. Reads wait for the newest rebuild. |
| `run_command` | One editor command (rename, suppress, delete, move, roll back, parameters, configurations, groups, …); `"new:<kind>"` makes ids for added rows. |
| `set_reference` / `set_value` / `set_parameter` | Write a picked reference into a feature's inputs; set a value's expression; create or change a parameter. |
| `begin_transaction` / `end_transaction` | Group changes into one undo step. |
| `sketch_create` / `get_sketch` | A sketch on a standard plane, face or construction plane; a sketch's rows, degrees of freedom and regions with handles. |
| `sketch_draw_line` / `_rectangle` / `_circle` / `_arc` / `_slot` / `_polygon` / `_ellipse` / `_spline` / `_point` | Drawing; points given by id or within a tolerance are shared. |
| `sketch_constrain` / `sketch_set_dimension` | Geometric constraints and dimensions with expressions; the sketch is solved and an over-constraint is refused. |
| `sketch_trim` / `_extend` / `_fillet` / `_offset` / `_mirror` / `_project` | Modify tools, and model edges brought in as external curves. |
| `sketch_pick_geometry` | The point or curve at a position in a sketch, as the in-app picker finds it, to name a curve for the modify tools. |
| `sketch_move_points` / `sketch_set_construction` / `sketch_delete` | Moving points, construction curves, deleting rows. |
| `feature_extrude` / `_revolve` / `_loft` / `_sweep` / `_fillet` / `_chamfer` / `_hole` / `_shell` / `_pattern` / `_mirror` / `_move` / `_boolean` / `_primitive` / `_thread` / `_construction` / `_remove_body` | Features, written as the app's panels write them; each returns its status after the rebuild. |
| `feature_freeze` | Freeze a feature (it keeps its result as last built, whatever changes before it) or make it live again. |
| `get_assembly` | An assembly's instances with their solved poses, joints with their values, motion links, groups, positions, exploded views, out-of-date contexts and its features with their copy counts. |
| `assembly_create` / `assembly_insert` / `assembly_move_instance` / `assembly_set_instance` / `assembly_delete` | Make an assembly; place, move, ground or suppress instances of parts, assemblies and library components; delete a row. |
| `assembly_joint` / `assembly_set_joint` / `assembly_drive` / `assembly_relation` / `assembly_group` | Joints between faces or round edges of instances; renaming, locking or suppressing one; driving their values (a locked joint is refused), motion links between joints, rigid groups and contact sets. Each edit writes back the pose it solves to. |
| `assembly_position` / `assembly_exploded_view` | Saved positions of the joints, and exploded views. |
| `feature_derive` | Another part's, an assembly's or a library component's bodies brought into a part, offset or mirrored, as new bodies or joined. |
| `assembly_update_contexts` / `assembly_hole_through` | Re-capture out-of-date contexts (a part using another part's geometry), and a hole through several parts. |
| `assembly_pattern` / `assembly_mirror` / `assembly_replicate` | Copy instances in a linear or circular pattern, mirror them in a plane (of the same hand, or of the opposite hand as new parts), or replicate them onto other faces or holes like the one they sit on; each edits an existing feature too. |
| `list_bodies` / `list_faces` / `list_edges` / `list_vertices` / `list_construction` / `measure` | What the model is built into, with handles and measures, and filters (a face's edges, the edge between two faces, faces facing a direction). |
| `view_fit_all` / `view_set_standard` / `view_zoom` / `view_screenshot` | The camera, and a JPEG of the viewport returned as image content. |

## Architecture notes

- **One session.** A second browser that connects while another is active is
  refused with WebSocket close code 1013 and a reason.
- **No cache.** Every call, reads included, goes to the browser, which holds
  the document; the bridge keeps only the tool list of the last `hello`.
- **Images.** A tool value `{kind: 'image', mimeType, data}` (the screenshot)
  is returned to the MCP client as image content.
- **Stdio is reserved for MCP.** All human-readable logging goes to stderr;
  writing diagnostics to stdout would corrupt the MCP framing.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

CI runs typecheck, lint and the test suite on every push. Contributions welcome —
see [CONTRIBUTING.md](./CONTRIBUTING.md); for a security issue, see
[SECURITY.md](./SECURITY.md) rather than opening an issue.

The test suite mocks the WebSocket client end-to-end; there's no need for a
running browser or MCP client to develop locally.

## License

GNU Affero General Public License, version 3 or later
([AGPL-3.0-or-later](./LICENSE)). Copyright © 2026 HumanHub / TweakCAD.
