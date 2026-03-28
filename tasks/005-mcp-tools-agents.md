# Task 005 — MCP Tools: Agent Management

**Wave:** 2 — MCP Package  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 2–3h  
**Depends on:** Task 004 (package scaffold)

---

## Goal

Implement four MCP Tools in `@opentriologue/mcp` that expose agent management features of the gateway:
- `ops_register` — register a new agent
- `ops_heartbeat` — send a heartbeat
- `ops_whoami` — get info about a specific agent
- `ops_list_agents` — list all registered agents

---

## File

`packages/mcp/src/tools/agents.ts`

---

## Implementation

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GatewayClient } from '../client.js';
import { Config } from '../config.js';

export function registerAgentTools(
  server: McpServer,
  client: GatewayClient,
  config: Config
): void {
  registerOpsTool(server, client, config);
  registerOpsHeartbeat(server, client, config);
  registerOpsWhoami(server, client, config);
  registerOpsListAgents(server, client);
}
```

---

### Tool: `ops_register`

**Purpose:** Register a new agent with the Triologue gateway. Returns the assigned agent ID.

**When to use:** An AI agent should call this at startup, before any other ops tools.

```typescript
function registerOpsTool(server: McpServer, client: GatewayClient, config: Config) {
  server.tool(
    'ops_register',
    'Register a new agent with the Triologue agent-ops gateway. Call this at startup to get an agent ID.',
    {
      name: z.string().min(1).describe('Human-readable name for this agent'),
      capabilities: z
        .array(z.string())
        .optional()
        .describe('List of capability tags, e.g. ["analyze", "summarize"]'),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe('Optional additional metadata to store with the agent registration'),
    },
    async ({ name, capabilities, metadata }) => {
      try {
        const result = await client.registerAgent({ name, capabilities, metadata });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                agentId: result.agentId,
                name: result.name,
                capabilities: result.capabilities,
                registeredAt: result.registeredAt,
                message: `Agent "${name}" registered successfully with ID: ${result.agentId}`,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : String(err),
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
```

**Example call:**
```json
{
  "name": "ops_register",
  "arguments": {
    "name": "analyst-agent",
    "capabilities": ["analyze", "summarize", "classify"],
    "metadata": { "version": "1.0.0", "owner": "team-alpha" }
  }
}
```

**Example response:**
```json
{
  "success": true,
  "agentId": "agent_abc123",
  "name": "analyst-agent",
  "capabilities": ["analyze", "summarize", "classify"],
  "registeredAt": "2026-03-28T15:00:00Z",
  "message": "Agent \"analyst-agent\" registered successfully with ID: agent_abc123"
}
```

---

### Tool: `ops_heartbeat`

**Purpose:** Send a heartbeat to the gateway to indicate the agent is still alive. Should be called periodically (every 30–60s).

```typescript
function registerOpsHeartbeat(server: McpServer, client: GatewayClient, config: Config) {
  server.tool(
    'ops_heartbeat',
    'Send a heartbeat to the gateway to keep the agent marked as active. Call every 30-60 seconds.',
    {
      agentId: z
        .string()
        .optional()
        .describe('Agent ID to send heartbeat for. Defaults to AGENT_ID env var if set.'),
      status: z
        .enum(['ok', 'busy', 'idle', 'error'])
        .optional()
        .default('ok')
        .describe('Current agent status'),
    },
    async ({ agentId, status }) => {
      const resolvedId = agentId ?? config.agentId;
      if (!resolvedId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'agentId is required (or set AGENT_ID environment variable)',
            }),
          }],
          isError: true,
        };
      }

      try {
        await client.sendHeartbeat(resolvedId, status ?? 'ok');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              agentId: resolvedId,
              status: status ?? 'ok',
              sentAt: new Date().toISOString(),
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          }],
          isError: true,
        };
      }
    }
  );
}
```

---

### Tool: `ops_whoami`

**Purpose:** Get the registration info and current status of a specific agent.

```typescript
function registerOpsWhoami(server: McpServer, client: GatewayClient, config: Config) {
  server.tool(
    'ops_whoami',
    'Get registration info and current status of an agent.',
    {
      agentId: z
        .string()
        .optional()
        .describe('Agent ID to look up. Defaults to AGENT_ID env var if set.'),
    },
    async ({ agentId }) => {
      const resolvedId = agentId ?? config.agentId;
      if (!resolvedId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'agentId is required (or set AGENT_ID environment variable)',
            }),
          }],
          isError: true,
        };
      }

      try {
        const agent = await client.getAgent(resolvedId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              agent: {
                id: agent.id,
                name: agent.name,
                capabilities: agent.capabilities,
                metadata: agent.metadata,
                status: agent.status,
                lastHeartbeat: agent.lastHeartbeat,
                registeredAt: agent.registeredAt,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          }],
          isError: true,
        };
      }
    }
  );
}
```

---

### Tool: `ops_list_agents`

**Purpose:** List all agents registered with the gateway, optionally filtered by status.

```typescript
function registerOpsListAgents(server: McpServer, client: GatewayClient) {
  server.tool(
    'ops_list_agents',
    'List all agents registered with the gateway. Optionally filter by status.',
    {
      status: z
        .enum(['active', 'inactive', 'all'])
        .optional()
        .default('all')
        .describe('Filter agents by status. "active" = sent heartbeat recently.'),
    },
    async ({ status }) => {
      try {
        const agents = await client.listAgents(status === 'all' ? undefined : status);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: agents.length,
              agents: agents.map(a => ({
                id: a.id,
                name: a.name,
                capabilities: a.capabilities,
                status: a.status,
                lastHeartbeat: a.lastHeartbeat,
                registeredAt: a.registeredAt,
              })),
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          }],
          isError: true,
        };
      }
    }
  );
}
```

---

## Testing

File: `packages/mcp/src/tools/__tests__/agents.test.ts`

Use Jest + mock the `GatewayClient`:

```typescript
// Mock GatewayClient
const mockClient = {
  registerAgent: jest.fn(),
  sendHeartbeat: jest.fn(),
  getAgent: jest.fn(),
  listAgents: jest.fn(),
} as unknown as GatewayClient;
```

Test cases:
1. `ops_register` — success path: verify tool calls `client.registerAgent` with correct args
2. `ops_register` — gateway error: verify `isError: true` in response
3. `ops_heartbeat` — with explicit agentId: verify `client.sendHeartbeat` called
4. `ops_heartbeat` — without agentId + no AGENT_ID env: verify error response
5. `ops_heartbeat` — with AGENT_ID env var: verify default agentId used
6. `ops_whoami` — found agent: verify agent data in response
7. `ops_whoami` — agent not found (404): verify error response
8. `ops_list_agents` — all agents: verify list returned
9. `ops_list_agents` — status=active filter: verify `client.listAgents('active')` called

---

## Definition of Done

- [ ] All 4 tools implemented in `src/tools/agents.ts`
- [ ] Each tool has a clear description string (used by the LLM to select the tool)
- [ ] Error paths return `isError: true` with descriptive error message
- [ ] `AGENT_ID` env var fallback works for `ops_heartbeat` and `ops_whoami`
- [ ] All 9 test cases passing
- [ ] `npm run build` succeeds
