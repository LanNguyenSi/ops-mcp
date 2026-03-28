# Task 004 — Scaffold @opentriologue/mcp Package

**Wave:** 2 — MCP Package  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 2–3h  
**Depends on:** Tasks 002, 003 (gateway must be running for integration tests)

---

## Goal

Create the `@opentriologue/mcp` npm package from scratch. This task covers scaffolding, configuration, the typed HTTP client for the gateway, and the MCP server skeleton — without implementing the actual tools (those are Tasks 005 and 006).

---

## Package Overview

| Property | Value |
|---|---|
| Package name | `@opentriologue/mcp` |
| Language | TypeScript |
| Transport | stdio (standard MCP) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Runtime | Node.js ≥ 18 |
| Entry point | `dist/index.js` (compiled from `src/index.ts`) |

---

## Directory Structure

Create at `packages/mcp/` within the ops-mcp repo:

```
packages/mcp/
├── package.json
├── tsconfig.json
├── .npmignore
├── README.md
├── src/
│   ├── index.ts          ← Entry: starts the MCP server
│   ├── server.ts         ← McpServer setup + tool registration
│   ├── client.ts         ← Typed HTTP client for agent-ops-gateway
│   ├── config.ts         ← Env var config
│   ├── types.ts          ← Shared TypeScript types
│   └── tools/
│       ├── agents.ts     ← Agent tools (Task 005)
│       └── state.ts      ← State tools (Task 006)
└── dist/                 ← Built output (gitignored)
```

---

## `package.json`

```json
{
  "name": "@opentriologue/mcp",
  "version": "0.1.0",
  "description": "MCP server for the Triologue agent-ops platform",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "opentriologue-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "test": "jest",
    "prepublishOnly": "npm run build"
  },
  "files": [
    "dist/**/*",
    "README.md"
  ],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "publishConfig": {
    "access": "public"
  },
  "keywords": ["mcp", "triologue", "agent-ops", "ai-agents", "model-context-protocol"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/LanNguyenSi/ops-mcp.git"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
```

---

## `src/config.ts`

```typescript
export interface Config {
  gatewayUrl: string;
  agentId: string | undefined;
}

export function loadConfig(): Config {
  const gatewayUrl = process.env.GATEWAY_URL;
  if (!gatewayUrl) {
    throw new Error(
      'GATEWAY_URL environment variable is required.\n' +
      'Set it to the URL of your agent-ops-gateway, e.g. http://localhost:3001'
    );
  }

  return {
    gatewayUrl: gatewayUrl.replace(/\/$/, ''), // strip trailing slash
    agentId: process.env.AGENT_ID,
  };
}
```

---

## `src/types.ts`

```typescript
// Agent types (mirrors gateway models)
export interface Agent {
  id: string;
  name: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
  status: 'active' | 'inactive';
  lastHeartbeat: string | null;
  registeredAt: string;
}

export interface RegisterAgentInput {
  name: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface RegisterAgentResult {
  agentId: string;
  name: string;
  capabilities: string[];
  registeredAt: string;
}

// State types
export interface StateEntry {
  id: string;
  namespace: string;
  key: string;
  value: Record<string, unknown>;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface StateListResult {
  namespace: string;
  count: number;
  keys: Array<{
    key: string;
    version: number;
    updatedBy: string | null;
    updatedAt: string;
  }>;
}

export interface CasConflictError {
  error: 'CAS_CONFLICT';
  expectedVersion: number;
  actualVersion: number;
  message: string;
}

// Event types
export interface AgentEvent {
  id: number;
  agentId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// MCP tool result helpers
export interface McpSuccess<T> {
  success: true;
  data: T;
}

export interface McpError {
  success: false;
  error: string;
  details?: unknown;
}

export type McpResult<T> = McpSuccess<T> | McpError;
```

---

## `src/client.ts`

Typed HTTP client wrapping `fetch` (Node 18+ built-in):

```typescript
import { Config } from './config.js';
import {
  Agent, RegisterAgentInput, RegisterAgentResult,
  StateEntry, StateListResult, CasConflictError
} from './types.js';

export class GatewayClient {
  constructor(private config: Config) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ data: T; status: number }> {
    const url = `${this.config.gatewayUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = res.status === 204 ? null : await res.json();
    return { data: data as T, status: res.status };
  }

  // Agent methods
  async registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult> {
    const { data, status } = await this.request<RegisterAgentResult>(
      'POST', '/api/agents/register', input
    );
    if (status !== 201 && status !== 200) throw new Error(`Register failed: ${JSON.stringify(data)}`);
    return data;
  }

  async sendHeartbeat(agentId: string, status = 'ok'): Promise<void> {
    await this.request('POST', `/api/agents/${agentId}/heartbeat`, { status });
  }

  async getAgent(agentId: string): Promise<Agent> {
    const { data, status } = await this.request<Agent>('GET', `/api/agents/${agentId}`);
    if (status === 404) throw new Error(`Agent not found: ${agentId}`);
    return data;
  }

  async listAgents(statusFilter?: string): Promise<Agent[]> {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const { data } = await this.request<{ agents: Agent[] }>('GET', `/api/agents${qs}`);
    return data.agents;
  }

  // State methods
  async getState(namespace: string, key: string): Promise<StateEntry | null> {
    const { data, status } = await this.request<StateEntry>('GET', `/api/state/${namespace}/${key}`);
    if (status === 404) return null;
    return data;
  }

  async setState(
    namespace: string,
    key: string,
    value: Record<string, unknown>,
    updatedBy?: string
  ): Promise<StateEntry> {
    const { data } = await this.request<StateEntry>(
      'PUT', `/api/state/${namespace}/${key}`, { value, updatedBy }
    );
    return data;
  }

  async casState(
    namespace: string,
    key: string,
    expectedVersion: number,
    value: Record<string, unknown>,
    updatedBy?: string
  ): Promise<StateEntry | CasConflictError> {
    const { data, status } = await this.request<StateEntry | CasConflictError>(
      'POST', `/api/state/${namespace}/${key}/cas`, { expectedVersion, value, updatedBy }
    );
    return data; // caller checks for error.error === 'CAS_CONFLICT'
  }

  async listState(namespace: string): Promise<StateListResult> {
    const { data } = await this.request<StateListResult>('GET', `/api/state/${namespace}`);
    return data;
  }

  async deleteState(namespace: string, key: string): Promise<boolean> {
    const { status } = await this.request('DELETE', `/api/state/${namespace}/${key}`);
    return status === 204;
  }
}
```

---

## `src/server.ts`

MCP server skeleton (tools registered in Tasks 005 and 006):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Config } from './config.js';
import { GatewayClient } from './client.js';
import { registerAgentTools } from './tools/agents.js';
import { registerStateTools } from './tools/state.js';

export async function createServer(config: Config): Promise<McpServer> {
  const server = new McpServer({
    name: 'opentriologue',
    version: '0.1.0',
  });

  const client = new GatewayClient(config);

  // Register all tool groups
  registerAgentTools(server, client, config);
  registerStateTools(server, client, config);

  return server;
}

export async function startServer(config: Config): Promise<void> {
  const server = await createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until process exits
}
```

---

## `src/index.ts`

```typescript
#!/usr/bin/env node

import { loadConfig } from './config.js';
import { startServer } from './server.js';

async function main() {
  try {
    const config = loadConfig();
    await startServer(config);
  } catch (err) {
    console.error('[opentriologue-mcp] Fatal error:', err);
    process.exit(1);
  }
}

main();
```

---

## `.npmignore`

```
src/
tsconfig.json
*.map
__tests__/
*.test.ts
.env*
```

---

## README.md

```markdown
# @opentriologue/mcp

MCP server for the [Triologue](https://opentriologue.ai) agent-ops platform.

Exposes the agent-ops gateway as MCP Tools, allowing AI agents (Claude, GPT, etc.)
to register, send heartbeats, and manage shared state through the Model Context Protocol.

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

​```json
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
​```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GATEWAY_URL` | ✅ | URL of agent-ops-gateway |
| `AGENT_ID` | — | Default agent ID for ops_whoami/ops_heartbeat |

## Available Tools

### Agent Tools
- `ops_register` — Register a new agent
- `ops_heartbeat` — Send a heartbeat
- `ops_whoami` — Get agent info
- `ops_list_agents` — List all agents

### State Tools
- `ops_state_get` — Get a state value
- `ops_state_set` — Set a state value
- `ops_state_cas` — Atomic compare-and-swap
- `ops_state_list` — List keys in a namespace
- `ops_state_delete` — Delete a key
```

---

## Definition of Done

- [ ] `package.json`, `tsconfig.json`, `.npmignore`, `README.md` created
- [ ] `config.ts`, `types.ts`, `client.ts`, `server.ts`, `index.ts` implemented
- [ ] `tools/agents.ts` and `tools/state.ts` exist as stubs (empty `registerAgentTools`/`registerStateTools` functions)
- [ ] `npm run build` succeeds (TypeScript compiles without errors)
- [ ] Package can be started: `GATEWAY_URL=http://localhost:3001 node dist/index.js` (starts MCP server, no crash)
- [ ] `npm pack` produces a valid tarball with only `dist/` and `README.md`
