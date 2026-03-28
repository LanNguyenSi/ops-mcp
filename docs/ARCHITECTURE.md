# Architecture — ops-mcp

**Author:** Ice  
**Version:** 1.0  
**Date:** 2026-03-28

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Triologue Ecosystem                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              agent-ops-gateway  :3001                        │   │
│  │                                                              │   │
│  │  Existing:                                                   │   │
│  │    POST /api/agents/register                                 │   │
│  │    POST /api/agents/:id/heartbeat                            │   │
│  │    GET  /api/agents                                          │   │
│  │                                                              │   │
│  │  New (Wave 1):                                               │   │
│  │    GET/POST/PUT/DELETE  /api/state/:namespace/:key           │   │
│  │    POST                 /api/state/:namespace/:key/cas       │   │
│  │    GET                  /api/state/:namespace               │   │
│  │    GET                  /api/events               (query)   │   │
│  │    GET                  /api/events/stream        (SSE)     │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │               PostgreSQL (depsight PG)              │    │   │
│  │  │                                                      │    │   │
│  │  │   agents        (existing)                          │    │   │
│  │  │   agent_state   (new) — namespaced KV + CAS         │    │   │
│  │  │   agent_events  (new) — append-only event log       │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          ▲         ▲                                │
│                          │ REST    │ REST                           │
│              ┌───────────┘         └──────────────┐                │
│              │                                    │                │
│  ┌───────────────────┐              ┌─────────────────────────┐    │
│  │  @opentriologue/  │              │  agent-ops-dashboard    │    │
│  │       mcp         │              │  ops.opentriologue.ai   │    │
│  │                   │              │                         │    │
│  │  MCP stdio server │              │  Agents tab (existing)  │    │
│  │  9 MCP Tools:     │              │  Activity tab (new)     │    │
│  │  - ops_register   │              │    └─ SSE consumer      │    │
│  │  - ops_heartbeat  │              │    └─ filter by agent   │    │
│  │  - ops_whoami     │              │    └─ filter by type    │    │
│  │  - ops_list_agents│              └─────────────────────────┘    │
│  │  - ops_state_get  │                         ▲                   │
│  │  - ops_state_set  │                         │ SSE               │
│  │  - ops_state_cas  │              /api/events/stream             │
│  │  - ops_state_list │                                             │
│  │  - ops_state_del  │                                             │
│  └───────────────────┘                                             │
│          ▲                                                          │
│          │ stdio (MCP protocol)                                     │
│   Claude / other LLM agent                                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema

### 2.1 `agent_state` — Namespaced Key-Value Store

```sql
CREATE TABLE agent_state (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace   TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  value       JSONB       NOT NULL DEFAULT '{}',
  version     INTEGER     NOT NULL DEFAULT 1,
  updated_by  TEXT,       -- agent id or "system"
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agent_state_namespace_key_unique UNIQUE (namespace, key)
);

CREATE INDEX idx_agent_state_namespace ON agent_state (namespace);
CREATE INDEX idx_agent_state_updated_at ON agent_state (updated_at DESC);
```

**Key properties:**
- `(namespace, key)` is the lookup key — globally unique
- `version` starts at 1 and increments on every update
- CAS (Compare-And-Swap) uses `WHERE version = $expected_version`
- `value` is JSONB — stores any JSON-serializable data
- `updated_by` is optional agent attribution

### 2.2 `agent_events` — Append-Only Event Log

```sql
CREATE TABLE agent_events (
  id          BIGSERIAL   PRIMARY KEY,
  agent_id    TEXT,       -- nullable (system events have no agent)
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_events_agent_id    ON agent_events (agent_id);
CREATE INDEX idx_agent_events_event_type  ON agent_events (event_type);
CREATE INDEX idx_agent_events_created_at  ON agent_events (created_at DESC);
```

**Key properties:**
- `id` is BIGSERIAL for cursor-based SSE replay (Last-Event-ID support)
- `agent_id` is nullable — system events (e.g. server start) have no agent
- `event_type` is a string enum (see Event Types below)
- `payload` is flexible JSONB for event-specific data
- Never updated, only inserted

### 2.3 Event Types

| Event Type | Trigger | Payload |
|---|---|---|
| `agent.registered` | POST /api/agents/register | `{ agentId, name, capabilities }` |
| `agent.heartbeat` | POST /api/agents/:id/heartbeat | `{ agentId, status }` |
| `agent.disconnected` | Heartbeat timeout (future) | `{ agentId, lastSeen }` |
| `state.set` | PUT /api/state/:ns/:key | `{ namespace, key, version, updatedBy }` |
| `state.deleted` | DELETE /api/state/:ns/:key | `{ namespace, key }` |
| `state.cas.success` | POST /api/state/:ns/:key/cas | `{ namespace, key, newVersion }` |
| `state.cas.conflict` | POST /api/state/:ns/:key/cas (conflict) | `{ namespace, key, expected, actual }` |

---

## 3. Gateway API — New Endpoints

### 3.1 State Store

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/state/:namespace` | List all keys in namespace |
| `GET` | `/api/state/:namespace/:key` | Get value by namespace+key |
| `PUT` | `/api/state/:namespace/:key` | Set/upsert value |
| `DELETE` | `/api/state/:namespace/:key` | Delete key |
| `POST` | `/api/state/:namespace/:key/cas` | Atomic Compare-And-Swap |

**GET `/api/state/:namespace`**
```json
{
  "namespace": "agent-alpha",
  "keys": [
    { "key": "task_queue", "version": 3, "updatedAt": "2026-03-28T15:00:00Z" },
    { "key": "preferences", "version": 1, "updatedAt": "2026-03-28T14:00:00Z" }
  ]
}
```

**GET `/api/state/:namespace/:key`**
```json
{
  "id": "550e8400-...",
  "namespace": "agent-alpha",
  "key": "task_queue",
  "value": { "tasks": ["analyze", "report"] },
  "version": 3,
  "updatedBy": "agent-alpha",
  "updatedAt": "2026-03-28T15:00:00Z"
}
```

**PUT `/api/state/:namespace/:key`**
Request:
```json
{ "value": { "tasks": ["analyze", "report", "summarize"] }, "updatedBy": "agent-alpha" }
```
Response: `200` with full state entry (updated version)

**POST `/api/state/:namespace/:key/cas`**
Request:
```json
{ "expectedVersion": 3, "value": { "tasks": ["summarize"] }, "updatedBy": "agent-alpha" }
```
Response on success: `200` with updated entry  
Response on conflict: `409 Conflict`
```json
{ "error": "CAS_CONFLICT", "expectedVersion": 3, "actualVersion": 4 }
```

### 3.2 Activity Feed / Events

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | Query events (paginated, filterable) |
| `GET` | `/api/events/stream` | SSE stream of live events |

**GET `/api/events`** — Query params: `agentId`, `eventType`, `since` (ISO timestamp), `limit`, `cursor` (event id for pagination)

**GET `/api/events/stream`** — SSE endpoint
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`
- Supports `Last-Event-ID` header for reconnect replay
- Filter params: `agentId`, `eventType`
- Each event: `id: <bigserial>`, `data: <JSON>`

```
id: 42
data: {"id":42,"agentId":"agent-alpha","eventType":"state.set","payload":{"namespace":"agent-alpha","key":"task_queue","version":4},"createdAt":"2026-03-28T15:01:00Z"}

id: 43
data: {"id":43,"agentId":"agent-beta","eventType":"agent.heartbeat","payload":{"status":"ok"},"createdAt":"2026-03-28T15:01:05Z"}
```

---

## 4. @opentriologue/mcp Package

### 4.1 Package Structure

```
packages/mcp/
├── package.json          # name: @opentriologue/mcp
├── tsconfig.json
├── src/
│   ├── index.ts          # Entry point — creates and starts MCP server
│   ├── server.ts         # McpServer instantiation + tool registration
│   ├── client.ts         # Typed HTTP client for agent-ops-gateway
│   ├── config.ts         # Env var config (GATEWAY_URL, AGENT_ID, AGENT_SECRET)
│   ├── tools/
│   │   ├── agents.ts     # ops_register, ops_heartbeat, ops_whoami, ops_list_agents
│   │   └── state.ts      # ops_state_get, ops_state_set, ops_state_cas, ops_state_list, ops_state_delete
│   └── types.ts          # Shared TypeScript types
├── README.md
└── dist/                 # Built output (tsc)
```

### 4.2 MCP Tool Definitions

#### Agent Tools

| Tool | Description | Inputs |
|---|---|---|
| `ops_register` | Register this agent with the gateway | `name: string`, `capabilities?: string[]`, `metadata?: object` |
| `ops_heartbeat` | Send a heartbeat to keep agent alive | `agentId: string`, `status?: string` |
| `ops_whoami` | Get current agent's registration info | `agentId: string` |
| `ops_list_agents` | List all registered agents | `status?: "active"\|"inactive"\|"all"` |

#### State Tools

| Tool | Description | Inputs |
|---|---|---|
| `ops_state_get` | Get a value from state store | `namespace: string`, `key: string` |
| `ops_state_set` | Set/upsert a value in state store | `namespace: string`, `key: string`, `value: object`, `updatedBy?: string` |
| `ops_state_cas` | Atomic Compare-And-Swap update | `namespace: string`, `key: string`, `expectedVersion: number`, `value: object`, `updatedBy?: string` |
| `ops_state_list` | List all keys in a namespace | `namespace: string` |
| `ops_state_delete` | Delete a key from state store | `namespace: string`, `key: string` |

### 4.3 Configuration (env vars)

```bash
GATEWAY_URL=http://localhost:3001   # Required: URL of agent-ops-gateway
AGENT_ID=my-agent                   # Optional: default agent ID for heartbeat/whoami
```

### 4.4 Claude Desktop Integration

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

---

## 5. Dashboard — Activity Tab

### 5.1 Route

New route: `/activity` in the Next.js dashboard app.

### 5.2 Components

```
app/activity/
├── page.tsx              # Main activity page
├── ActivityFeed.tsx      # SSE consumer + event list
├── EventCard.tsx         # Single event row
├── EventFilters.tsx      # Filter bar (agentId, eventType, date range)
└── useActivityStream.ts  # Custom hook: SSE connection + state
```

### 5.3 SSE Consumer Hook (`useActivityStream`)

```typescript
// Connects to GET /api/events/stream
// Reconnects automatically with Last-Event-ID
// Returns: { events, isConnected, error, clearEvents }
```

### 5.4 UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Agents] [Activity]          ops.opentriologue.ai       │
├─────────────────────────────────────────────────────────┤
│  Activity Feed                        ● Live             │
│                                                          │
│  Filter: [All Agents ▼] [All Types ▼] [Last 1h ▼]       │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 15:01:05  agent-alpha  state.set                 │    │
│  │           namespace: agent-alpha, key: task_q... │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 15:01:00  agent-beta   agent.heartbeat           │    │
│  │           status: ok                             │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 14:59:42  agent-alpha  agent.registered          │    │
│  │           name: Alpha, capabilities: [analyze]  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Data Flow

### Agent Registration Flow
```
AI Agent
  → MCP Tool: ops_register
  → @opentriologue/mcp client
  → POST /api/agents/register (gateway)
  → INSERT into agents table
  → INSERT event: agent.registered into agent_events
  → SSE push to all /api/events/stream subscribers
  → Dashboard Activity tab receives event, updates UI
```

### State CAS Flow
```
AI Agent
  → MCP Tool: ops_state_cas
  → POST /api/state/:namespace/:key/cas (gateway)
  → BEGIN TRANSACTION
  → SELECT current version (FOR UPDATE)
  → If version matches: UPDATE agent_state, increment version
  → INSERT event: state.cas.success into agent_events
  → COMMIT
  → SSE push event
  → Return updated entry to MCP tool
```

### SSE Reconnect Flow
```
Dashboard loses connection
  → EventSource fires onerror
  → useActivityStream hook retries with exponential backoff
  → Reconnect request includes Last-Event-ID: <lastSeenId>
  → Gateway queries agent_events WHERE id > lastSeenId
  → Replays missed events, then continues live stream
```

---

## 7. Tech Stack Summary

| Layer | Tech |
|---|---|
| Gateway language | TypeScript (Node.js) |
| Gateway framework | Express |
| Database | PostgreSQL (existing depsight instance) |
| DB client | `pg` (node-postgres) |
| DB migrations | SQL migration files (existing pattern) |
| Validation | Zod |
| MCP SDK | `@modelcontextprotocol/sdk` |
| MCP transport | stdio |
| Dashboard | Next.js (App Router) |
| SSE client | Native `EventSource` API |
| Testing | Jest + supertest (gateway), Jest (MCP tools) |
