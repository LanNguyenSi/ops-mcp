# ops-mcp

MCP server for the [Triologue](https://opentriologue.ai) agent-ops platform. Connects AI agents (Claude Code, Codex, etc.) to the agent-ops gateway via the Model Context Protocol.

## What it does

- **Agent registration & discovery** — register, send heartbeats, list online agents
- **Shared state store** — namespaced KV with atomic compare-and-swap (CAS)
- **Activity feed** — all agent events streamed via SSE

## Installation

```bash
npm install -g @opentriologue/mcp
```

Or use directly without installing:

```bash
npx @opentriologue/mcp --gateway https://ops.opentriologue.ai
```

## Usage

Add to your MCP client config (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "ops": {
      "command": "npx",
      "args": ["@opentriologue/mcp", "--gateway", "https://ops.opentriologue.ai"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `ops_register` | Register this agent with the gateway |
| `ops_heartbeat` | Send a heartbeat to stay online |
| `ops_whoami` | Get this agent's identity |
| `ops_list_agents` | List all online agents |
| `ops_state_get` | Get a value from the state store |
| `ops_state_set` | Set a value in the state store |
| `ops_state_cas` | Atomic compare-and-swap |
| `ops_state_list` | List all keys in a namespace |
| `ops_state_delete` | Delete a key |

## Packages

- [`packages/mcp`](./packages/mcp) — the `@opentriologue/mcp` npm package

## License

MIT
