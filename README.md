# @tweakcad/mcp-bridge

Drive [TweakCAD](https://tweakcad.com) from any MCP client: Claude Desktop,
Claude Code, Cursor, Windsurf, VS Code, Codex, Zed and others. The bridge is a
small Node CLI (Node 24 or later). It speaks MCP over stdio to the client and
relays each tool call over a local WebSocket (`ws://127.0.0.1:7788`) to the
TweakCAD tab, which runs it against the open document.

```
+----------------+     stdio (MCP)     +-----------------+    ws (JSON)    +----------------+
|  MCP client    | <-----------------> |  tweakcad-mcp   | <-------------> |  TweakCAD tab  |
+----------------+                     +-----------------+                 +----------------+
```

The bridge holds no document state and runs no tool logic. The tab sends its
tool list when it connects, so the client sees exactly the tools the running
app has.

## Setup

1. **Add the bridge to your MCP client** (below). The client starts it with
   `npx -y @tweakcad/mcp-bridge`; there is nothing to install by hand.
2. **Turn it on in the app:** open TweakCAD, click **Settings** (top right),
   and in the **AI** tab tick **Enable AI bridge** (default address
   `localhost:7788`). A dot beside the Settings icon turns green when the tab
   is connected.

Ask the assistant to call `cad_help` first; it explains the document and the
tools.

### Claude Code

```bash
claude mcp add tweakcad -- npx -y @tweakcad/mcp-bridge
```

### Claude Desktop, Cursor, Windsurf, Cline, Gemini CLI

```json
{
  "mcpServers": {
    "tweakcad": {
      "command": "npx",
      "args": ["-y", "@tweakcad/mcp-bridge"]
    }
  }
}
```

| Client | Config file |
|---|---|
| Claude Desktop | Settings → Developer → Edit Config (`claude_desktop_config.json`); restart the app after saving |
| Cursor | `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | MCP Servers → Configure (`cline_mcp_settings.json`) |
| Gemini CLI | `~/.gemini/settings.json` |

### VS Code

`.vscode/mcp.json` in the workspace (note `servers`, not `mcpServers`):

```json
{
  "servers": {
    "tweakcad": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@tweakcad/mcp-bridge"]
    }
  }
}
```

### Codex CLI

```bash
codex mcp add tweakcad -- npx -y @tweakcad/mcp-bridge
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.tweakcad]
command = "npx"
args = ["-y", "@tweakcad/mcp-bridge"]
```

### Zed

`settings.json`:

```json
{
  "context_servers": {
    "tweakcad": {
      "command": "npx",
      "args": ["-y", "@tweakcad/mcp-bridge"]
    }
  }
}
```

### Notes

- **Windows:** if the client cannot start `npx`, use `"command": "cmd"` with
  `"args": ["/c", "npx", "-y", "@tweakcad/mcp-bridge"]`.
- **No tools listed?** Turn the bridge on in the app, then reconnect the
  server in your client. The bridge waits a few seconds for the tab when the
  client first asks; clients that support `tools/list_changed` pick the tools
  up whenever the tab connects.
- **One bridge at a time.** The port serves one bridge and one tab. A second
  client starting the bridge on the same port fails with a message saying so;
  give it another `--port` and set that port in the app.

## Options

Add them after the package name in `args`, e.g.
`["-y", "@tweakcad/mcp-bridge", "--port", "7790"]`.

```
--port, -p <number>      WebSocket port (default 7788)
--timeout <seconds>      How long a tool call waits for the app (default 60)
--allow-origin <origin>  Also accept the app from this origin, e.g. a self-hosted
                         https://cad.example.com (repeatable)
--version, -v            Print the version
--help, -h               Show usage
```

Only pages from `https://tweakcad.com`, from `localhost` (any port) and from
`--allow-origin` origins may connect; any other page is refused.

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
| `feature_extrude` / `_revolve` / `_loft` / `_sweep` / `_fillet` / `_chamfer` / `_hole` / `_shell` / `_pattern` / `_mirror` / `_move` / `_boolean` / `_primitive` / `_thread` / `_construction` / `_split` / `_remove_body` | Features, written as the app's panels write them; each returns its status after the rebuild. |
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

- **One session.** A second tab that connects while another is attached is
  refused during the handshake (HTTP 409), so its socket never opens and it
  keeps retrying until the first tab leaves.
- **Origins.** A handshake whose `Origin` is not allowed (see Options) is
  refused with HTTP 403. Clients that send no `Origin` (local programs, not
  pages) are accepted; the port listens on `127.0.0.1` only.
- **Contract.** The bridge relays whatever catalogue the tab announces, of any
  contract version, and logs the version and tool count to stderr.
- **Timeouts.** A call with no reply within `--timeout` fails with a message
  saying the app may still have applied it; so does a call in flight when the
  tab disconnects. The tab runs calls one at a time, in order.
- **No cache.** Every call, reads included, goes to the browser, which holds
  the document; the bridge keeps only the tool list of the last `hello`.
- **Lifetime.** The bridge exits when the client closes its stdin.
- **Images.** A tool value `{kind: 'image', mimeType, data}` (the screenshot)
  is returned to the MCP client as image content.
- **Stdio is reserved for MCP.** All human-readable logging goes to stderr;
  writing diagnostics to stdout would corrupt the MCP framing.

## Development

Node 24 or later, pnpm through `corepack enable`:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

To try a local build in a client, use `"command": "node"` with
`"args": ["/absolute/path/to/mcp-bridge/dist/cli.js"]` instead of `npx`.

CI runs typecheck, lint and the test suite on every push. Contributions welcome —
see [CONTRIBUTING.md](./CONTRIBUTING.md); for a security issue, see
[SECURITY.md](./SECURITY.md) rather than opening an issue.

The tests drive the bridge with a scripted tab over a real WebSocket and an
in-memory MCP client; no browser is needed.

## License

GNU Affero General Public License, version 3 or later
([AGPL-3.0-or-later](./LICENSE)). Copyright © 2026 HumanHub / TweakCAD.
