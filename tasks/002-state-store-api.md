# Task 002 — PostgreSQL State Store Schema + CRUD API

**Wave:** 1 — Foundation  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 3–4h  
**Depends on:** Task 001 (architecture review)

---

## Goal

Add a namespaced, versioned key-value State Store to `agent-ops-gateway`. Backed by PostgreSQL, with atomic Compare-And-Swap (CAS) support.

---

## Context

The `agent_state` table will be created in the existing PostgreSQL instance (depsight PG). The gateway needs new migration files, a data-access layer, and Express route handlers.

---

## Schema

Create migration file: `migrations/002_agent_state.sql`

```sql
CREATE TABLE agent_state (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace   TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  value       JSONB       NOT NULL DEFAULT '{}',
  version     INTEGER     NOT NULL DEFAULT 1,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agent_state_namespace_key_unique UNIQUE (namespace, key)
);

CREATE INDEX idx_agent_state_namespace ON agent_state (namespace);
CREATE INDEX idx_agent_state_updated_at ON agent_state (updated_at DESC);
```

---

## API Routes

All routes under `/api/state`. Add to `agent-ops-gateway`.

### GET `/api/state/:namespace`

List all keys in a namespace.

**Response 200:**
```json
{
  "namespace": "agent-alpha",
  "count": 2,
  "keys": [
    {
      "key": "task_queue",
      "version": 3,
      "updatedBy": "agent-alpha",
      "updatedAt": "2026-03-28T15:00:00Z"
    },
    {
      "key": "preferences",
      "version": 1,
      "updatedBy": null,
      "updatedAt": "2026-03-28T14:00:00Z"
    }
  ]
}
```

**SQL:**
```sql
SELECT key, version, updated_by, updated_at
FROM agent_state
WHERE namespace = $1
ORDER BY updated_at DESC;
```

---

### GET `/api/state/:namespace/:key`

Get a single state entry.

**Response 200:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "namespace": "agent-alpha",
  "key": "task_queue",
  "value": { "tasks": ["analyze", "report"] },
  "version": 3,
  "updatedBy": "agent-alpha",
  "updatedAt": "2026-03-28T15:00:00Z",
  "createdAt": "2026-03-28T14:00:00Z"
}
```

**Response 404:** `{ "error": "NOT_FOUND", "namespace": "...", "key": "..." }`

**SQL:**
```sql
SELECT * FROM agent_state WHERE namespace = $1 AND key = $2;
```

---

### PUT `/api/state/:namespace/:key`

Create or update a state entry. Upserts — creates if not exists, updates if exists.

**Request body:**
```json
{
  "value": { "tasks": ["analyze", "report", "summarize"] },
  "updatedBy": "agent-alpha"
}
```

**Validation (Zod):**
```typescript
const PutStateSchema = z.object({
  value: z.record(z.unknown()),   // any JSON object
  updatedBy: z.string().optional()
});
```

**Response 200:** Full state entry (same shape as GET)

**SQL (upsert):**
```sql
INSERT INTO agent_state (namespace, key, value, updated_by)
VALUES ($1, $2, $3, $4)
ON CONFLICT (namespace, key) DO UPDATE
SET value = EXCLUDED.value,
    version = agent_state.version + 1,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
RETURNING *;
```

**Side effect:** Emit `state.set` event to `agent_events` (see Task 003).

---

### DELETE `/api/state/:namespace/:key`

Delete a state entry.

**Response 204:** (no body on success)

**Response 404:** `{ "error": "NOT_FOUND" }`

**SQL:**
```sql
DELETE FROM agent_state
WHERE namespace = $1 AND key = $2
RETURNING id;
```

**Side effect:** Emit `state.deleted` event to `agent_events`.

---

### POST `/api/state/:namespace/:key/cas`

Atomic Compare-And-Swap. Only updates if the current version matches `expectedVersion`.

**Request body:**
```json
{
  "expectedVersion": 3,
  "value": { "tasks": ["summarize"] },
  "updatedBy": "agent-alpha"
}
```

**Validation (Zod):**
```typescript
const CasStateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  value: z.record(z.unknown()),
  updatedBy: z.string().optional()
});
```

**Response 200:** Full updated entry

**Response 409 Conflict:**
```json
{
  "error": "CAS_CONFLICT",
  "expectedVersion": 3,
  "actualVersion": 4,
  "message": "Version mismatch. The state was modified by another writer."
}
```

**Response 404:** Key does not exist yet

**SQL (single atomic statement):**
```sql
UPDATE agent_state
SET value      = $3,
    version    = version + 1,
    updated_by = $4,
    updated_at = NOW()
WHERE namespace = $1
  AND key       = $2
  AND version   = $5
RETURNING *;
```

If `rowCount === 0`:
- Check if key exists at all → if not: 404
- If exists: current version != expected → 409

**Side effect:** Emit `state.cas.success` or `state.cas.conflict` event.

---

## Implementation Plan

### Files to create/modify in `agent-ops-gateway`

```
src/
├── db/
│   └── migrations/
│       └── 002_agent_state.sql      ← new
├── state/
│   ├── state.routes.ts              ← new: Express router
│   ├── state.service.ts             ← new: DB queries
│   └── state.schema.ts              ← new: Zod schemas
└── app.ts                           ← modify: mount /api/state router
```

### Migration runner

If the gateway doesn't already have a migration runner, add a simple one:
```typescript
// src/db/migrate.ts
// Reads all *.sql files in migrations/ sorted by filename, runs each in order
// Tracks applied migrations in a `_migrations` table
```

### Event emission

After each successful state mutation, call the event service (Task 003) to log:
```typescript
await eventService.emit('state.set', agentId, {
  namespace, key, version: updated.version, updatedBy
});
```

(Task 003 will implement `eventService.emit`; for Task 002 implementation, stub it or use a simple placeholder that logs to console until Task 003 is complete.)

---

## Testing

File: `src/state/__tests__/state.routes.test.ts`

Test cases:
1. `PUT /api/state/ns/key` → creates entry, returns version 1
2. `GET /api/state/ns/key` → returns entry
3. `PUT /api/state/ns/key` (again) → updates entry, version becomes 2
4. `GET /api/state/ns` → lists both keys
5. `POST /api/state/ns/key/cas` with correct version → succeeds, version increments
6. `POST /api/state/ns/key/cas` with wrong version → 409 Conflict
7. `DELETE /api/state/ns/key` → 204
8. `GET /api/state/ns/key` after delete → 404
9. Concurrent CAS: two simultaneous CAS requests with same expectedVersion → only one succeeds

---

## Definition of Done

- [ ] Migration SQL created
- [ ] All 5 route handlers implemented and mounted
- [ ] Zod validation on all request bodies
- [ ] All test cases passing
- [ ] Events stubbed/wired for Task 003
- [ ] No raw SQL strings in route handlers (all in service layer)
