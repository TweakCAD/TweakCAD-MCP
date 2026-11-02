# Contributing to @tweakcad/mcp-bridge

This package is deliberately small: a stdio↔WebSocket relay with no document
state and two runtime dependencies. Most ideas that start "the bridge should
also…" belong in the editor instead, because the browser is the source of
truth and the thing that owns the tool catalogue.

## Setup

Node 24, pnpm via `corepack enable`.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test        # vitest; the WebSocket client end is mocked, no browser needed
pnpm build
```

## The two rules that matter here

**Stdio is reserved for MCP framing.** Every human-readable byte goes to
stderr. A stray `console.log` corrupts the protocol and the failure looks like
a confused client, not a logging bug.

**The bridge holds no state.** Tool calls are forwarded; the only thing cached
is what the browser pushes for the read-only tools. If a change needs the
bridge to know what a document contains, it is probably the wrong layer — open
an issue and describe the flow.

## Tests

A test that fails without your change. Break the fix on purpose and watch it
go red; if it stays green, it isn't testing what you think. The relay is small
enough that this is always cheap.

## Dependencies

Exact versions, no `^` or `~`. New runtime dependencies are a hard sell — this
ships as an npm package people run in their editor, and the dependency count
is part of the point.

## Commits and PRs

Commit subjects say what changed or which problem was fixed. No filler, no
tool or model attribution. PR descriptions: what changed, why, what you ran.

## Security

Don't open a public issue for a vulnerability — see [SECURITY.md](./SECURITY.md).

## License

Contributions are licensed under the [AGPL-3.0-or-later](./LICENSE), the same
terms as the project.
