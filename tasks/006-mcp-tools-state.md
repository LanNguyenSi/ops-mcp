# Task 006 — MCP Tools: State Store

**Wave:** 2 — MCP Package  
**Status:** Ready  
**Assignee:** Ice  
**Estimated effort:** 2–3h  
**Depends on:** Task 004 (scaffold), Task 002 (state store API must be deployed)

---

## Goal

Implement five MCP Tools in `@opentriologue/mcp` that expose the State Store:
- `ops_state_get` — get a value by namespace + key
- `ops_state_set` — set/upsert a value
- `ops_state_cas` — atomic compare-and-swap
- `ops_state_list` — list all keys in a namespace
- `ops_state_delete` — delete a key

---

## File

`packages/mcp/src/tools/state.ts`

---

## Implementation

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GatewayClient } from '../client.js';
import { Config } from '../config.js';

export function registerStateTools(
  server: McpServer,
  client: GatewayClient,
  _config: Config
): void {
  registerOpsStateGet(server, client);
  registerOpsStateSet(server, client);
  registerOpsStateCas(server, client);
  registerOpsStateList(server, client);
  registerOpsStateDelete(server, client);
}
```

---

### Tool: `ops_state_get`

**Purpose:** Retrieve a value from the namespaced state store. Returns null if the key doesn't exist.

```typescript
function registerOpsStateGet(server: McpServer, client: GatewayClient) {
  server.tool(
    'ops_state_get',
    'Get a value from the state store by namespace and key. Returns null if not found.',
    {
      namespace: z.string().min(1).describe(
        'Namespace to scope the key (typically your agent ID or a shared namespace like "shared")'
      ),
      key: z.string().min(1).describe('The key to retrieve'),
    },
    async ({ namespace, key }) => {
      try {
        const entry = await client.getState(namespace, key);
        if (!entry) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                found: false,
                namespace,
                key,
                value: null,
              }, null, 2),
            }],
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              found: true,
              namespace: entry.namespace,
              key: entry.key,
              value: entry.value,
              version: entry.version,
              updatedBy: entry.updatedBy,
              updatedAt: entry.updatedAt,
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

**Example call:**
```json
{
  "name": "ops_state_get",
  "arguments": { "namespace": "agent-alpha", "key": "task_queue" }
}
```

**Example response (found):**
```json
{
  "success": true,
  "found": true,
  "namespace": "agent-alpha",
  "key": "task_queue",
  "value": { "tasks": ["analyze", "report"] },
  "version": 3,
  "updatedBy": "agent-alpha",
  "updatedAt": "2026-03-28T15:00:00Z"
}
```

**Example response (not found):**
```json
{
  "success": true,
  "found": false,
  "namespace": "agent-alpha",
  "key": "task_queue",
  "value": null
}
```

---

### Tool: `ops_state_set`

**Purpose:** Set or update a value in the state store. Creates the key if it doesn't exist; overwrites if it does. Use `ops_state_cas` instead when you need safe concurrent updates.

```typescript
function registerOpsStateSet(server: McpServer, client: GatewayClient) {
  server.tool(
    'ops_state_set',
    'Set or upsert a value in the state store. Creates the key if absent, overwrites if present. For concurrent-safe updates, use ops_state_cas instead.',
    {
      namespace: z.string().min(1).describe('Namespace to scope the key'),
      key: z.string().min(1).describe('The key to set'),
      value: z.record(z.unknown()).describe('JSON object value to store'),
      updatedBy: z.string().optional().describe('Optional attribution — who is setting this value (e.g. your agent ID)'),
    },
    async ({ namespace, key, value, updatedBy }) => {
      try {
        const entry = await client.setState(namespace, key, value, updatedBy);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              namespace: entry.namespace,
              key: entry.key,
              value: entry.value,
              version: entry.version,
              updatedBy: entry.updatedBy,
              updatedAt: entry.updatedAt,
              message: `State stored at ${namespace}/${key} (version ${entry.version})`,
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

### Tool: `ops_state_cas`

**Purpose:** Atomic Compare-And-Swap. Only updates the value if the current version matches `expectedVersion`. Use this for safe concurrent state updates when multiple agents may write to the same key.

This is the most important state tool for multi-agent coordination — it prevents lost updates.

```typescript
function registerOpsStateCas(server: McpServer, client: GatewayClient) {
  server.tool(
    'ops_state_cas',
    'Atomically update a state value only if the current version matches expectedVersion. Returns the updated entry on success, or a conflict error if the version has changed. Use this for safe concurrent updates across multiple agents.',
    {
      namespace: z.string().min(1).describe('Namespace to scope the key'),
      key: z.string().min(1).describe('The key to update'),
      expectedVersion: z.number().int().positive().describe(
        'The version you expect the current value to have. Get this from ops_state_get first.'
      ),
      value: z.record(z.unknown()).describe('The new JSON object value to store if the version matches'),
      updatedBy: z.string().optional().describe('Optional attribution — your agent ID'),
    },
    async ({ namespace, key, expectedVersion, value, updatedBy }) => {
      try {
        const result = await client.casState(namespace, key, expectedVersion, value, updatedBy);

        // Check for CAS conflict
        if ('error' in result && result.error === 'CAS_CONFLICT') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                conflict: true,
                error: 'CAS_CONFLICT',
                expectedVersion: result.expectedVersion,
                actualVersion: result.actualVersion,
                message: `Version conflict: expected ${result.expectedVersion} but current version is ${result.actualVersion}. Fetch the latest value with ops_state_get and retry.`,
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Success
        const entry = result as import('../types.js').StateEntry;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              namespace: entry.namespace,
              key: entry.key,
              value: entry.value,
              version: entry.version,
              updatedBy: entry.updatedBy,
              updatedAt: entry.updatedAt,
              message: `CAS succeeded. State at ${namespace}/${key} updated to version ${entry.version}.`,
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

**Example conflict response:**
```json
{
  "success": false,
  "conflict": true,
  "error": "CAS_CONFLICT",
  "expectedVersion": 3,
  "actualVersion": 4,
  "message": "Version conflict: expected 3 but current version is 4. Fetch the latest value with ops_state_get and retry."
}
```

---

### Tool: `ops_state_list`

**Purpose:** List all keys stored in a namespace, including their versions and last-updated times.

```typescript
function registerOpsStateList(server: McpServer, client: GatewayClient) {
  server.tool(
    'ops_state_list',
    'List all keys stored in a namespace with their versions and last-updated timestamps.',
    {
      namespace: z.string().min(1).describe('Namespace to list keys from'),
    },
    async ({ namespace }) => {
      try {
        const result = await client.listState(namespace);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              namespace: result.namespace,
              count: result.count,
              keys: result.keys,
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

**Example response:**
```json
{
  "success": true,
  "namespace": "agent-alpha",
  "count": 2,
  "keys": [
    { "key": "task_queue", "version": 3, "updatedBy": "agent-alpha", "updatedAt": "2026-03-28T15:00:00Z" },
    { "key": "preferences", "version": 1, "updatedBy": null, "updatedAt": "2026-03-28T14:00:00Z" }
  ]
}
```

---

### Tool: `ops_state_delete`

**Purpose:** Delete a key from the state store.

```typescript
function registerOpsStateDelete(server: McpServer, client: GatewayClient) {
  server.tool(
    'ops_state_delete',
    'Delete a key from the state store. Returns success even if the key did not exist.',
    {
      namespace: z.string().min(1).describe('Namespace of the key to delete'),
      key: z.string().min(1).describe('The key to delete'),
    },
    async ({ namespace, key }) => {
      try {
        const deleted = await client.deleteState(namespace, key);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              deleted,
              namespace,
              key,
              message: deleted
                ? `Key "${key}" deleted from namespace "${namespace}"`
                : `Key "${key}" not found in namespace "${namespace}" (already deleted or never existed)`,
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

File: `packages/mcp/src/tools/__tests__/state.test.ts`

Test cases:
1. `ops_state_get` — key exists: verify value and version returned
2. `ops_state_get` — key not found: verify `found: false`, no error
3. `ops_state_set` — creates new key: verify version 1
4. `ops_state_set` — overwrites existing key: verify version incremented
5. `ops_state_cas` — version matches: verify updated entry returned
6. `ops_state_cas` — version conflict: verify `isError: true` + conflict details
7. `ops_state_cas` — key not found (404 from gateway): verify error response
8. `ops_state_list` — namespace with keys: verify array of key metadata
9. `ops_state_list` — empty namespace: verify `count: 0, keys: []`
10. `ops_state_delete` — key exists: verify `deleted: true`
11. `ops_state_delete` — key not found: verify `deleted: false`, no error

---

## CAS Usage Pattern (for LLM documentation)

The canonical pattern for safe concurrent state updates:

```
1. ops_state_get(namespace, key)           → get current value + version
2. Compute new value locally
3. ops_state_cas(namespace, key, version, newValue)
   → If success: done
   → If CAS_CONFLICT: go back to step 1 and retry
```

This pattern ensures no lost updates, even when multiple agents write concurrently.

---

## Definition of Done

- [ ] All 5 tools implemented in `src/tools/state.ts`
- [ ] CAS conflict returns `isError: true` with clear retry instructions
- [ ] `ops_state_get` distinguishes "not found" (success, `found: false`) from errors
- [ ] `ops_state_delete` is idempotent (no error if key absent)
- [ ] All 11 test cases passing
- [ ] `npm run build` succeeds
- [ ] Tool descriptions are clear enough for an LLM to use without additional docs
