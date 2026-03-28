# Project Charter — ops-mcp

**Project:** ops-mcp  
**Status:** Planning  
**Author:** Ice  
**Created:** 2026-03-28  
**Repo target:** `@opentriologue/mcp` + extensions to `agent-ops-gateway` + `agent-ops-dashboard`

---

## 1. Purpose

The **ops-mcp** project extends the Triologue agent-ops platform with three tightly coupled capabilities:

1. **State Store** — a namespaced, versioned key-value store backed by PostgreSQL, enabling agents to persist and share lightweight structured state across sessions.
2. **Activity Feed** — an append-only event log that captures every significant action (agent registration, heartbeats, state changes, messages) and streams it live to subscribers via SSE.
3. **MCP Server Package (`@opentriologue/mcp`)** — a publishable npm package that wraps the gateway's REST API as a suite of MCP Tools, allowing any MCP-compatible AI agent (Claude, GPT, custom LLM) to interact with the Triologue ops platform through the standard Model Context Protocol.

Together, these give the Triologue ecosystem a durable, observable, and AI-interoperable operations backbone.

---

## 2. Background & Motivation

### What we have today
| Component | Tech | Purpose |
|---|---|---|
| `agent-ops-gateway` | Node.js / TypeScript / Express | Agent registry, heartbeat tracking, REST API on port 3001 |
| `agent-ops-dashboard` | Next.js | Web UI at ops.opentriologue.ai — lists registered agents |
| Triologue | Node.js | AI-to-AI-to-Human chat on port 4001 |
| depsight PostgreSQL | PostgreSQL | Existing DB instance available for reuse |

### What's missing
- Agents have no way to persist state between invocations
- No audit trail — we can't replay "what happened and when"
- AI agents need programmatic access to the gateway (currently REST-only, no MCP interface)
- The dashboard is static — no live event feed

### Why now
The Triologue AI-to-AI conversation model requires agents to coordinate. Coordination requires shared state and a reliable event trail. MCP is becoming the de-facto standard for LLM-to-tool interaction; building a first-class MCP server makes the gateway accessible to the entire MCP ecosystem with zero integration friction.

---

## 3. Goals

### Primary Goals
- [x] Add `agent_state` table to PostgreSQL with full CRUD API + atomic CAS
- [x] Add `agent_events` table + append-only event log API + SSE stream endpoint
- [x] Publish `@opentriologue/mcp` as an npm package (stdio transport, TypeScript)
- [x] Add "Activity" tab to ops.opentriologue.ai dashboard with live SSE feed

### Secondary Goals
- Provide a clean, typed TypeScript SDK surface in the MCP package
- Ensure all new gateway endpoints are consistently validated (Zod)
- 80%+ test coverage on new gateway code and MCP tools

### Non-Goals (for this phase)
- Redis/in-memory caching of state (use PG directly for now)
- WebSocket transport for MCP (stdio only in v1)
- Multi-tenancy or auth for the state store (namespaces provide logical isolation)
- Triologue-native SSE subscriptions (gateway SSE only in v1)

---

## 4. Scope

### In Scope
| Area | Change |
|---|---|
| `agent-ops-gateway` | New routes: `/api/state/*`, `/api/events/*` (including SSE stream) |
| `agent-ops-gateway` | New DB migrations: `agent_state`, `agent_events` tables |
| `agent-ops-gateway` | Event emission on all existing routes (register, heartbeat) |
| `@opentriologue/mcp` | New package from scratch; 9 MCP tools |
| `agent-ops-dashboard` | New "Activity" tab with SSE consumer |

### Out of Scope
- Changes to Triologue core
- Changes to depsight
- Auth / RBAC
- Deployment / infra changes (existing deployment pipeline reused)

---

## 5. Stakeholders

| Role | Person |
|---|---|
| Project Lead | Lan |
| Architecture & Implementation | Ice (AI Agent) |
| Review | Lan |

---

## 6. Delivery Plan (Waves)

### Wave 1 — Foundation (Tasks 001–003)
Establish docs, database schema, and server-side APIs. No UI, no MCP yet.

### Wave 2 — MCP Package (Tasks 004–006)
Scaffold and implement the `@opentriologue/mcp` package with all 9 tools.

### Wave 3 — Dashboard + Polish (Tasks 007–008)
Add the Activity tab to the dashboard, add integration tests, harden error handling.

---

## 7. Success Criteria

1. `agent-ops-gateway` passes all existing tests + new tests for state/events endpoints
2. `@opentriologue/mcp` can be installed locally and used with a Claude Desktop config
3. A new agent can: register → write state → read state → CAS update → see all events in dashboard
4. SSE stream delivers events within 500ms of the triggering action
5. Package published to npm registry as `@opentriologue/mcp`

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| PostgreSQL connection pooling in gateway may need tuning | Use pgpool or configure pg pool size explicitly |
| SSE client reconnection state | Use `Last-Event-ID` header + cursor-based replay from `agent_events` |
| MCP SDK API changes | Pin SDK version, upgrade deliberately |
| npm publish scope requires org | Create `@opentriologue` org on npm or use `--access public` on first publish |
