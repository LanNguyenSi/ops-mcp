# Task 008 — Integration Tests + Error Handling

**Wave:** 3 — Dashboard + Polish  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 3–4h  
**Depends on:** Tasks 002, 003, 005, 006 (all implementations complete)

---

## Goal

Add end-to-end integration tests covering the full ops-mcp stack, and harden error handling across all layers. By the end of this task, the system should gracefully handle all common failure modes (DB down, key not found, version conflicts, network errors, SSE disconnect).

---

## Scope

1. **Gateway integration tests** — test state + events APIs against a real test database
2. **MCP package integration tests** — test all 9 tools against a running gateway instance
3. **Error handling audit** — review and fix all layers for consistent error responses
4. **SSE stress test** — multiple concurrent SSE subscribers, high event rate

---

## 1. Gateway Integration Tests

### Setup

Create `test/integration/` directory in `agent-ops-gateway`.

Use a test PostgreSQL database (separate from production):

```typescript
// test/integration/setup.ts
import { Client } from 'pg';

export async function setupTestDb(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/agent_ops_test',
  });
  await client.connect();

  // Run migrations
  await client.query(await fs.readFile('migrations/002_agent_state.sql', 'utf8'));
  await client.query(await fs.readFile('migrations/003_agent_events.sql', 'utf8'));

  return client;
}

export async function clearTestDb(client: Client): Promise<void> {
  await client.query('TRUNCATE agent_state, agent_events, agents RESTART IDENTITY CASCADE');
}

export async function teardownTestDb(client: Client): Promise<void> {
  await client.end();
}
```

### Test: State Store Full Lifecycle

File: `test/integration/state.integration.test.ts`

```typescript
describe('State Store — Full Lifecycle', () => {
  let app: Express;
  let db: Client;

  beforeAll(async () => {
    db = await setupTestDb();
    app = createApp(db);
  });

  afterEach(async () => {
    await clearTestDb(db);
  });

  afterAll(async () => {
    await teardownTestDb(db);
  });

  test('PUT → GET → PUT → GET: upsert and version increment', async () => {
    // Create
    const create = await request(app)
      .put('/api/state/ns-test/my-key')
      .send({ value: { count: 1 }, updatedBy: 'test-agent' })
      .expect(200);
    expect(create.body.version).toBe(1);

    // Read
    const read = await request(app).get('/api/state/ns-test/my-key').expect(200);
    expect(read.body.value).toEqual({ count: 1 });

    // Update
    const update = await request(app)
      .put('/api/state/ns-test/my-key')
      .send({ value: { count: 2 }, updatedBy: 'test-agent' })
      .expect(200);
    expect(update.body.version).toBe(2);

    // List namespace
    const list = await request(app).get('/api/state/ns-test').expect(200);
    expect(list.body.count).toBe(1);
    expect(list.body.keys[0].key).toBe('my-key');
  });

  test('CAS: success path', async () => {
    await request(app)
      .put('/api/state/ns-test/counter')
      .send({ value: { n: 0 } });

    const cas = await request(app)
      .post('/api/state/ns-test/counter/cas')
      .send({ expectedVersion: 1, value: { n: 1 }, updatedBy: 'agent-a' })
      .expect(200);

    expect(cas.body.version).toBe(2);
    expect(cas.body.value).toEqual({ n: 1 });
  });

  test('CAS: conflict when version mismatch', async () => {
    await request(app)
      .put('/api/state/ns-test/counter')
      .send({ value: { n: 0 } });

    // Update to version 2
    await request(app)
      .put('/api/state/ns-test/counter')
      .send({ value: { n: 1 } });

    // CAS with old version 1 → conflict
    const cas = await request(app)
      .post('/api/state/ns-test/counter/cas')
      .send({ expectedVersion: 1, value: { n: 99 } })
      .expect(409);

    expect(cas.body.error).toBe('CAS_CONFLICT');
    expect(cas.body.expectedVersion).toBe(1);
    expect(cas.body.actualVersion).toBe(2);
  });

  test('CAS concurrent writes: only one winner', async () => {
    await request(app)
      .put('/api/state/ns-test/shared')
      .send({ value: { writers: [] } });

    // Two concurrent CAS requests with same expected version
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/state/ns-test/shared/cas')
        .send({ expectedVersion: 1, value: { writers: ['agent-a'] } }),
      request(app)
        .post('/api/state/ns-test/shared/cas')
        .send({ expectedVersion: 1, value: { writers: ['agent-b'] } }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]); // one wins, one loses
  });

  test('DELETE: removes key, returns 404 on second read', async () => {
    await request(app).put('/api/state/ns-test/to-delete').send({ value: {} });
    await request(app).delete('/api/state/ns-test/to-delete').expect(204);
    await request(app).get('/api/state/ns-test/to-delete').expect(404);
  });

  test('GET non-existent key: 404', async () => {
    await request(app).get('/api/state/ns-test/nope').expect(404);
  });

  test('Invalid request body: 400', async () => {
    await request(app)
      .put('/api/state/ns-test/bad')
      .send({ value: 'not-an-object' }) // value must be an object
      .expect(400);
  });
});
```

### Test: Activity Feed + SSE

File: `test/integration/events.integration.test.ts`

```typescript
describe('Activity Feed', () => {
  test('Event emitted on agent registration appears in GET /api/events', async () => {
    await request(app)
      .post('/api/agents/register')
      .send({ name: 'test-agent', capabilities: ['test'] });

    const res = await request(app).get('/api/events').expect(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.events[0].eventType).toBe('agent.registered');
  });

  test('GET /api/events filters by agentId', async () => {
    await eventService.emit('agent.heartbeat', 'agent-a', { status: 'ok' });
    await eventService.emit('agent.heartbeat', 'agent-b', { status: 'ok' });

    const res = await request(app).get('/api/events?agentId=agent-a').expect(200);
    expect(res.body.events.every((e: AgentEvent) => e.agentId === 'agent-a')).toBe(true);
  });

  test('GET /api/events?cursor pagination works', async () => {
    // Emit 15 events
    for (let i = 0; i < 15; i++) {
      await eventService.emit('agent.heartbeat', 'agent-x', { i });
    }

    const page1 = await request(app).get('/api/events?limit=10').expect(200);
    expect(page1.body.events.length).toBe(10);
    const lastId = page1.body.events[9].id;

    const page2 = await request(app).get(`/api/events?cursor=${lastId}&limit=10`).expect(200);
    expect(page2.body.events.length).toBe(5);
  });

  test('SSE: event received within 1s of emission', async () => {
    const received: AgentEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SSE timeout')), 5000);
      const es = new EventSource(`http://localhost:${TEST_PORT}/api/events/stream`);

      es.onmessage = (msg) => {
        received.push(JSON.parse(msg.data));
        if (received.length >= 1) {
          clearTimeout(timeout);
          es.close();
          resolve();
        }
      };

      // Emit after SSE connected
      setTimeout(async () => {
        await eventService.emit('state.set', 'test-agent', { key: 'x' });
      }, 200);
    });

    expect(received[0].eventType).toBe('state.set');
  });

  test('SSE: Last-Event-ID replay on reconnect', async () => {
    // Emit 5 events
    const emitted: AgentEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await eventService.emit('state.set', 'test-agent', { i });
      emitted.push(e);
    }

    // Connect with Last-Event-ID of 3rd event → should receive events 4 and 5
    const replayReceived: AgentEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Replay timeout')), 5000);
      const url = `http://localhost:${TEST_PORT}/api/events/stream?lastEventId=${emitted[2].id}`;
      const es = new EventSource(url);

      es.onmessage = (msg) => {
        replayReceived.push(JSON.parse(msg.data));
        if (replayReceived.length >= 2) {
          clearTimeout(timeout);
          es.close();
          resolve();
        }
      };
    });

    expect(replayReceived.length).toBe(2);
    expect(replayReceived[0].id).toBe(emitted[3].id);
    expect(replayReceived[1].id).toBe(emitted[4].id);
  });
});
```

---

## 2. MCP Package Integration Tests

File: `packages/mcp/src/__tests__/integration.test.ts`

These tests run against a live gateway instance (started in `beforeAll`).

```typescript
describe('MCP Package — Integration', () => {
  let client: GatewayClient;
  const config: Config = {
    gatewayUrl: process.env.GATEWAY_URL ?? 'http://localhost:3001',
    agentId: undefined,
  };

  beforeAll(() => {
    client = new GatewayClient(config);
  });

  test('Register agent → heartbeat → whoami → list', async () => {
    const reg = await client.registerAgent({ name: 'mcp-int-test', capabilities: ['test'] });
    expect(reg.agentId).toBeTruthy();

    await client.sendHeartbeat(reg.agentId, 'ok');

    const agent = await client.getAgent(reg.agentId);
    expect(agent.name).toBe('mcp-int-test');

    const agents = await client.listAgents();
    expect(agents.some(a => a.id === reg.agentId)).toBe(true);
  });

  test('State: set → get → CAS → conflict → delete', async () => {
    const ns = `mcp-test-${Date.now()}`;

    // Set
    const set = await client.setState(ns, 'x', { v: 1 }, 'mcp-test');
    expect(set.version).toBe(1);

    // Get
    const get = await client.getState(ns, 'x');
    expect(get?.value).toEqual({ v: 1 });

    // CAS success
    const cas = await client.casState(ns, 'x', 1, { v: 2 }, 'mcp-test');
    expect('error' in cas).toBe(false);
    expect((cas as StateEntry).version).toBe(2);

    // CAS conflict (still expect version 1)
    const conflict = await client.casState(ns, 'x', 1, { v: 99 });
    expect('error' in conflict).toBe(true);
    expect((conflict as CasConflictError).error).toBe('CAS_CONFLICT');

    // List
    const list = await client.listState(ns);
    expect(list.keys.length).toBe(1);
    expect(list.keys[0].key).toBe('x');

    // Delete
    const deleted = await client.deleteState(ns, 'x');
    expect(deleted).toBe(true);

    // Confirm deleted
    const gone = await client.getState(ns, 'x');
    expect(gone).toBeNull();
  });
});
```

---

## 3. Error Handling Audit

### Gateway — Checklist

Review all new route handlers for:

| Check | What to verify |
|---|---|
| Zod validation errors | Return `400` with `{ error: 'VALIDATION_ERROR', details: zodError }` |
| DB connection errors | Catch pg errors, return `503` with `{ error: 'DATABASE_ERROR' }` — do NOT leak connection strings |
| Not found | Return `404` with `{ error: 'NOT_FOUND', namespace?, key? }` |
| CAS conflict | Return `409` with `{ error: 'CAS_CONFLICT', expectedVersion, actualVersion }` |
| Unexpected errors | Return `500` with `{ error: 'INTERNAL_ERROR' }` — no stack traces in production |
| SSE cleanup | Verify all SSE subscribers are removed on client disconnect (no memory leak) |

Add a global error handler in `app.ts` if not already present:

```typescript
// src/app.ts — add at the bottom, before export
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[gateway] Unhandled error:', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An internal error occurred',
  });
});
```

### MCP Package — Checklist

| Check | What to verify |
|---|---|
| Gateway unreachable | Catch fetch errors, return `isError: true` with `"Gateway unreachable: ..."` |
| Non-JSON gateway response | Catch JSON parse errors |
| CAS conflict | Explicitly handled (not treated as generic error) |
| Missing required config | `loadConfig()` throws on missing GATEWAY_URL — verified in Task 004 |
| All tools have try/catch | Verify no tool can throw uncaught |

---

## 4. SSE Subscriber Leak Test

```typescript
test('SSE: 50 concurrent subscribers, no memory leak after disconnect', async () => {
  const initialSubscribers = eventService.subscriberCount();

  const connections = await Promise.all(
    Array.from({ length: 50 }, () => connectSSE(`http://localhost:${TEST_PORT}/api/events/stream`))
  );

  expect(eventService.subscriberCount()).toBe(initialSubscribers + 50);

  // Disconnect all
  connections.forEach(es => es.close());
  await new Promise(r => setTimeout(r, 100)); // allow cleanup

  expect(eventService.subscriberCount()).toBe(initialSubscribers);
});
```

Requires adding `subscriberCount(): number` to `EventService` (for testing only).

---

## 5. CI Configuration

Add integration test scripts to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest --testPathPattern='__tests__'",
    "test:integration": "jest --testPathPattern='integration' --runInBand"
  }
}
```

Add to `.github/workflows/ci.yml` (if exists):

```yaml
- name: Run integration tests
  env:
    TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/agent_ops_test
    GATEWAY_URL: http://localhost:3001
  run: |
    npm run test:integration
```

---

## Definition of Done

- [ ] Gateway integration tests: all state store scenarios passing
- [ ] Gateway integration tests: activity feed + SSE tests passing
- [ ] MCP integration tests: full lifecycle test passing
- [ ] Global error handler in gateway (no 500s leaking stack traces)
- [ ] Zod validation errors return 400 consistently
- [ ] SSE subscriber leak test passing
- [ ] `npm test` green in both `agent-ops-gateway` and `packages/mcp`
- [ ] CI pipeline updated to run integration tests
- [ ] Test coverage ≥ 80% on new code (check with `jest --coverage`)
