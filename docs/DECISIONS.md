# Decisions Log — ops-mcp

**Author:** Ice  
**Started:** 2026-03-28

This log captures architectural and implementation decisions made during the ops-mcp project. Each entry includes context, the options considered, the decision made, and the rationale.

---

## ADR-001: State Store Backend — PostgreSQL vs SQLite

**Date:** 2026-03-28  
**Status:** Decided

### Context
The State Store needs a persistent, queryable KV backend. The gateway currently has no database dependency. depsight already runs a PostgreSQL instance that is available for reuse.

### Options Considered
1. **PostgreSQL (depsight instance)** — reuse existing managed PG
2. **SQLite** — lightweight, embedded, zero infra
3. **Redis** — fast, native KV semantics

### Decision
**PostgreSQL (depsight instance)**

### Rationale
- Reuses existing infrastructure — no new services to manage
- ACID transactions enable proper CAS semantics with `SELECT ... FOR UPDATE`
- JSONB gives flexible value storage with indexing capability
- Already available; SQLite would work but adds a new runtime file dependency and doesn't support concurrent writes as gracefully
- Redis would require a new service and is overkill for current scale; can be added as a caching layer later if needed

---

## ADR-002: MCP Transport — stdio vs HTTP/SSE

**Date:** 2026-03-28  
**Status:** Decided

### Context
MCP supports multiple transport mechanisms. The primary use case is AI agents using Claude Desktop or similar clients.

### Options Considered
1. **stdio** — spawns the MCP server as a child process, communicates over stdin/stdout
2. **HTTP+SSE** — runs as an HTTP server, clients connect via SSE for streaming

### Decision
**stdio transport**

### Rationale
- stdio is the standard for Claude Desktop integrations and the most widely supported transport in MCP clients
- No port management required — avoids conflicts with gateway (3001) and Triologue (4001)
- Simpler deployment: `npx @opentriologue/mcp` just works
- HTTP transport can be added as an alternative in a future version (the MCP SDK supports both)

---

## ADR-003: Activity Feed — SSE vs WebSockets vs Polling

**Date:** 2026-03-28  
**Status:** Decided

### Context
The dashboard needs live updates of agent events. We need to choose a push mechanism for the gateway-to-dashboard stream.

### Options Considered
1. **SSE (Server-Sent Events)** — HTTP/1.1, unidirectional, native browser support
2. **WebSockets** — bidirectional, requires ws library
3. **Client-side polling** — simple, but adds latency and unnecessary load

### Decision
**SSE (Server-Sent Events)**

### Rationale
- The dashboard only needs to **receive** events (unidirectional) — WebSockets are unnecessary complexity
- SSE has native browser `EventSource` API — no client library needed
- SSE supports `Last-Event-ID` for automatic reconnect with missed-event replay
- Works through HTTP proxies and load balancers without special configuration
- Polling ruled out: real-time feel requires <1s latency, polling would hammer the DB

---

## ADR-004: Event IDs — BIGSERIAL vs UUID

**Date:** 2026-03-28  
**Status:** Decided

### Context
`agent_events` needs an ID type that supports cursor-based pagination and SSE `Last-Event-ID` replay.

### Options Considered
1. **BIGSERIAL** — auto-incrementing integer, naturally ordered
2. **UUID** — universally unique, not ordered

### Decision
**BIGSERIAL**

### Rationale
- SSE `Last-Event-ID` is a string, but BIGSERIAL integers work perfectly as event IDs in SSE (clients send back the last ID they saw)
- Cursor-based pagination with `WHERE id > $cursor` is trivially efficient with integer IDs and a btree index
- Ordering is implicit — BIGSERIAL values are monotonically increasing, so the event log is naturally ordered by insertion time
- UUID would require an additional `created_at` index for ordering; BIGSERIAL gives ordering for free

---

## ADR-005: CAS Implementation — Application-Level vs Database-Level

**Date:** 2026-03-28  
**Status:** Decided

### Context
The State Store requires atomic Compare-And-Swap: "only update if current version equals expected version."

### Options Considered
1. **Application-level CAS** — SELECT then UPDATE in two queries, with optimistic locking
2. **Database-level CAS** — `UPDATE ... WHERE version = $expected RETURNING *` in a single statement
3. **SELECT FOR UPDATE in a transaction** — explicit row lock

### Decision
**Database-level CAS with `UPDATE ... WHERE version = $expected RETURNING *`**

### Rationale
- Single-statement approach is atomic by definition in PostgreSQL — no explicit transaction needed
- `RETURNING *` gives us the updated row in one round-trip
- We check `rowCount`: if 0, the version didn't match → return 409 Conflict
- Simpler than SELECT FOR UPDATE, which requires explicit transaction management
- Application-level (SELECT + UPDATE) is not atomic and vulnerable to TOCTOU race conditions

```sql
UPDATE agent_state
SET value = $value, version = version + 1, updated_by = $updatedBy, updated_at = NOW()
WHERE namespace = $namespace AND key = $key AND version = $expectedVersion
RETURNING *;
```

---

## ADR-006: Package Scope — @opentriologue/mcp

**Date:** 2026-03-28  
**Status:** Decided

### Context
The MCP package needs an npm package name.

### Decision
**`@opentriologue/mcp`** under the `@opentriologue` npm organization scope.

### Rationale
- Scoped packages allow future packages (`@opentriologue/sdk`, `@opentriologue/types`) under the same org
- `@opentriologue/mcp` is clear, short, and descriptive
- Requires creating `@opentriologue` org on npm (free, public)
- First publish: `npm publish --access public`

---

## ADR-007: Gateway Extension vs Separate Service

**Date:** 2026-03-28  
**Status:** Decided

### Context
Should the State Store and Activity Feed be added to the existing `agent-ops-gateway` or be a separate microservice?

### Decision
**Extend existing `agent-ops-gateway`**

### Rationale
- Current scale does not justify a second service
- State Store and Activity Feed are fundamentally tied to agent lifecycle events — they belong in the same service
- Avoids inter-service network calls for event emission on agent registration/heartbeat
- Simpler deployment — one fewer service to manage
- Can extract to a separate service if scale requires it later

---

## ADR-008: Dashboard Framework — New Route vs Separate App

**Date:** 2026-03-28  
**Status:** Decided

### Context
The Activity tab could be a new route in the existing Next.js dashboard or a separate deployed app.

### Decision
**New route `/activity` in existing `agent-ops-dashboard`**

### Rationale
- Existing Next.js app already deployed at ops.opentriologue.ai — adding a tab is trivial
- Shared layout (nav, auth if added later) without duplication
- Single deployment target — no new subdomain or infra required
