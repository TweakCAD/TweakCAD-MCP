# Security policy

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private vulnerability
reporting: the **Security** tab → **Report a vulnerability**.

Include what an attacker can do, what they need to start, and the shortest
reproduction you have.

## What this package is

A relay. It speaks MCP over stdio to a client and JSON over a WebSocket to a
browser tab, and holds no document state of its own.

That shape is where the interesting problems live:

- **The WebSocket listener binds `127.0.0.1` by default.** Anything that gets
  it listening on another interface, or that lets a page from another origin
  connect to it, hands arbitrary editor control to whoever can reach the port —
  the bridge is a trusted channel to a running editor.
- **Stdio framing.** Anything that lets forwarded content break out of the MCP
  framing and look like a message from the bridge.
- **Argument handling.** The bridge forwards tool arguments; anything that
  turns one into a command, a path or a file read on the host is a bug here,
  not in the editor.

Less interesting: a malformed message that produces an error and a closed
socket. That is the relay working.

## Scope

Vulnerabilities in the editor itself belong in the
[TweakCAD](https://github.com/HumanHub/TweakCAD) repository, and server-side
issues can be reported through either — they will be routed.

## Supported versions

Pre-1.0: fixes land on `main` and ship in the next npm release. There are no
maintained release branches.
