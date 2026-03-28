# Task 003 — Activity Feed Schema + API + SSE Endpoint

**Wave:** 1 — Foundation  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 3–4h  
**Depends on:** Task 001 (architecture review)  
**Parallel with:** Task 002 (no dependency between 002 and 003)

---

## Goal

Add an append-only Activity Feed (event log) to `agent-ops-gateway`. Every significant action — agent registration, heartbeat, state changes — gets logged. A real-time SSE endpoint streams events to subscribers (dashboard, external monitors).

---

## Schema

Create migration file: `migrations/003_agent_events.sql`

```sql
CREATE TABLE agent_events (
  id          BIGSERIAL   PRIMARY KEY,
  agent_id    TEXT,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_events_agent_id    ON agent_events (agent_id);
CREATE INDEX idx_agent_events_event_type  ON agent_events (event_type);
CREATE INDEX idx_agent_events_created_at  ON agent_events (created_at DESC);
```

**Notes:**
- `id` is BIGSERIAL (not UUID) to support cursor-based pagination and SSE `Last-Event-ID`
- `agent_id` is nullable — system events have no agent
- `payload` is JSONB with event-specific data

---

## Event Types

Define as a TypeScript enum/union:

```typescript
export const EVENT_TYPES = {
  AGENT_REGISTERED:    'agent.registered',
  AGENT_HEARTBEAT:     'agent.heartbeat',
  AGENT_DISCONNECTED:  'agent.disconnected',
  STATE_SET:           'state.set',
  STATE_DELETED:       'state.deleted',
  STATE_CAS_SUCCESS:   'state.cas.success',
  STATE_CAS_CONFLICT:  'state.cas.conflict',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
```

---

## Event Service

Create `src/events/event.service.ts`:

```typescript
export class EventService {
  // Append an event to agent_events
  async emit(
    eventType: EventType,
    agentId: string | null,
    payload: Record<string, unknown>
  ): Promise<AgentEvent> {
    const result = await db.query(
      `INSERT INTO agent_events (agent_id, event_type, payload)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [agentId, eventType, JSON.stringify(payload)]
    );
    const event = result.rows[0];
    // Notify all active SSE subscribers
    this.broadcast(event);
    return event;
  }

  // In-memory subscriber set for SSE
  private subscribers: Set<SSESubscriber> = new Set();

  subscribe(subscriber: SSESubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private broadcast(event: AgentEvent): void {
    for (const sub of this.subscribers) {
      if (sub.matches(event)) {
        sub.send(event);
      }
    }
  }
}
```

**Singleton:** Export a single `eventService` instance from `src/events/event.service.ts`.

---

## Wire Event Emission into Existing Routes

Modify the following existing gateway routes to emit events:

### `POST /api/agents/register`
```typescript
await eventService.emit('agent.registered', agentId, {
  agentId, name, capabilities, metadata
});
```

### `POST /api/agents/:id/heartbeat`
```typescript
await eventService.emit('agent.heartbeat', agentId, {
  agentId, status
});
```

Also wire into Task 002 state routes (or ensure Task 002 calls `eventService.emit` for all mutations).

---

## API Routes

All routes under `/api/events`.

### GET `/api/events`

Query the event log. Paginated, filterable.

**Query parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `agentId` | string | — | Filter by agent ID |
| `eventType` | string | — | Filter by event type |
| `since` | ISO timestamp | — | Only events after this time |
| `cursor` | integer | — | Events with id > cursor (for pagination) |
| `limit` | integer | 50 | Max results (max 200) |

**Response 200:**
```json
{
  "events": [
    {
      "id": 42,
      "agentId": "agent-alpha",
      "eventType": "state.set",
      "payload": { "namespace": "agent-alpha", "key": "task_queue", "version": 4 },
      "createdAt": "2026-03-28T15:01:00Z"
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

**SQL:**
```sql
SELECT * FROM agent_events
WHERE ($1::text IS NULL OR agent_id = $1)
  AND ($2::text IS NULL OR event_type = $2)
  AND ($3::timestamptz IS NULL OR created_at > $3)
  AND ($4::bigint IS NULL OR id > $4)
ORDER BY id ASC
LIMIT $5;
```

---

### GET `/api/events/stream`

SSE endpoint for live event streaming.

**Query parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `agentId` | string | — | Filter: only events for this agent |
| `eventType` | string | — | Filter: only this event type |

**Request headers (automatic from EventSource):**
- `Last-Event-ID`: last event ID seen by client (for reconnect replay)

**Response headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**SSE message format:**
```
id: 42
event: agent.registered
data: {"id":42,"agentId":"agent-alpha","eventType":"agent.registered","payload":{...},"createdAt":"..."}

id: 43
event: agent.heartbeat
data: {"id":43,"agentId":"agent-beta","eventType":"agent.heartbeat","payload":{"status":"ok"},"createdAt":"..."}

```

**Implementation:**

```typescript
router.get('/stream', async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const { agentId, eventType } = req.query as Record<string, string>;
  const lastEventId = req.headers['last-event-id'];

  // Replay missed events on reconnect
  if (lastEventId) {
    const missed = await eventService.getEventsSince(
      parseInt(lastEventId as string),
      { agentId, eventType }
    );
    for (const event of missed) {
      sendSSEEvent(res, event);
    }
  }

  // Send heartbeat comment every 30s to keep connection alive
  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30_000);

  // Subscribe to live events
  const unsubscribe = eventService.subscribe({
    matches: (event) =>
      (!agentId || event.agentId === agentId) &&
      (!eventType || event.eventType === eventType),
    send: (event) => sendSSEEvent(res, event),
  });

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    unsubscribe();
  });
});

function sendSSEEvent(res: Response, event: AgentEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.eventType}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```

---

## Implementation Plan

### Files to create/modify in `agent-ops-gateway`

```
src/
├── db/
│   └── migrations/
│       └── 003_agent_events.sql          ← new
├── events/
│   ├── event.service.ts                  ← new: EventService singleton
│   ├── event.routes.ts                   ← new: Express router (GET /events, SSE)
│   ├── event.schema.ts                   ← new: Zod validation for query params
│   └── __tests__/
│       └── event.routes.test.ts          ← new: tests
├── agents/
│   └── agent.routes.ts                   ← modify: emit events on register/heartbeat
└── app.ts                                ← modify: mount /api/events router
```

---

## Testing

File: `src/events/__tests__/event.routes.test.ts`

Test cases:
1. `eventService.emit('agent.registered', 'agent-1', {...})` → inserts into DB, returns event with BIGSERIAL id
2. `GET /api/events` → returns all events
3. `GET /api/events?agentId=agent-1` → filters by agent
4. `GET /api/events?eventType=agent.heartbeat` → filters by type
5. `GET /api/events?cursor=5&limit=10` → returns events with id > 5
6. SSE: connect to `/api/events/stream`, emit event via `eventService.emit`, verify SSE message received
7. SSE reconnect: connect with `Last-Event-ID: 10`, verify events 11+ are replayed before live stream

---

## Definition of Done

- [ ] Migration SQL created
- [ ] `EventService` class with `emit`, `subscribe`, `broadcast` implemented
- [ ] `GET /api/events` with all filter params working
- [ ] `GET /api/events/stream` SSE endpoint working
- [ ] `Last-Event-ID` replay working
- [ ] Existing routes (register, heartbeat) wired to emit events
- [ ] All test cases passing
- [ ] SSE connection cleanup on client disconnect (no memory leaks)
