<!--
Short is fine: what changed, why, and what you ran. See CONTRIBUTING.md.
-->

## What and why

## How it was verified

<!-- For a fix: what did you break on purpose to watch the new test fail? -->

## Checklist

- [ ] A test fails without this change (I checked by breaking the fix)
- [ ] `pnpm typecheck && pnpm test` green
- [ ] Nothing new writes to stdout (stdio is MCP framing only)
- [ ] No new runtime dependency, or justified above
