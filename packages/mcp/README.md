# @opentriologue/mcp

MCP server for the [Triologue](https://opentriologue.ai) agent-ops platform.

Exposes the agent-ops gateway as MCP Tools, allowing AI agents (Claude, GPT, etc.)
to register, send heartbeats, and manage shared state through the Model Context Protocol.

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opentriologue": {
      "command": "npx",
      "args": ["-y", "@opentriologue/mcp"],
      "env": {
        "GATEWAY_URL": "http://localhost:3001"
      }
    }
  }
}
```

### Manual

```bash
GATEWAY_URL=http://localhost:3001 npx @opentriologue/mcp
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GATEWAY_URL` | ✅ | URL of agent-ops-gateway |
| `AGENT_ID` | — | Default agent ID for `ops_whoami` / `ops_heartbeat` |

## Available Tools

### Agent Tools
- `ops_register` — Register a new agent with the gateway
- `ops_heartbeat` — Send a heartbeat to keep the agent alive
- `ops_whoami` — Get info about the current agent
- `ops_list_agents` — List all registered agents

### State Tools
- `ops_state_get` — Get a value from the shared state store
- `ops_state_set` — Set a value in the shared state store
- `ops_state_cas` — Atomic compare-and-swap (conflict-safe updates)
- `ops_state_list` — List all keys in a namespace
- `ops_state_delete` — Delete a key from the state store

## Architecture

```
Claude / AI Agent
      │
      │  MCP (stdio)
      ▼
@opentriologue/mcp
      │
      │  HTTP REST
      ▼
agent-ops-gateway  ──── PostgreSQL (state + events)
      │
      │  SSE
      ▼
ops.opentriologue.ai (dashboard)
```
