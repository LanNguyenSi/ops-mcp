import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GatewayClient } from "../client.js";
import type { Config } from "../config.js";
import type { CasConflictError } from "../types.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errResult(error: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2) }],
    isError: true,
  };
}

function isCasConflict(v: unknown): v is CasConflictError {
  return typeof v === "object" && v !== null && (v as CasConflictError).error === "CAS_CONFLICT";
}

export function registerStateTools(
  server: McpServer,
  client: GatewayClient,
  _config: Config
): void {
  // ── ops_state_get ─────────────────────────────────────────
  server.tool(
    "ops_state_get",
    "Get a value from the state store by namespace and key. Returns null if not found.",
    {
      namespace: z.string().min(1).describe("Namespace (typically your agent ID or 'shared')"),
      key: z.string().min(1).describe("The key to retrieve"),
    },
    async ({ namespace, key }) => {
      try {
        const entry = await client.getState(namespace, key);
        if (!entry) {
          return ok({ success: true, found: false, namespace, key, value: null });
        }
        return ok({
          success: true,
          found: true,
          namespace: entry.namespace,
          key: entry.key,
          value: entry.value,
          version: entry.version,
          updatedBy: entry.updatedBy,
          updatedAt: entry.updatedAt,
        });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── ops_state_set ─────────────────────────────────────────
  server.tool(
    "ops_state_set",
    "Set or upsert a value in the state store. Creates the key if absent, overwrites if present. For concurrent-safe updates, use ops_state_cas instead.",
    {
      namespace: z.string().min(1).describe("Namespace to scope the key"),
      key: z.string().min(1).describe("The key to set"),
      value: z.record(z.string(), z.unknown()).describe("JSON object value to store"),
      updatedBy: z.string().optional().describe("Optional: who is setting this (e.g. your agent ID)"),
    },
    async ({ namespace, key, value, updatedBy }) => {
      try {
        const entry = await client.setState(namespace, key, value, updatedBy);
        return ok({
          success: true,
          namespace: entry.namespace,
          key: entry.key,
          value: entry.value,
          version: entry.version,
          updatedBy: entry.updatedBy,
          updatedAt: entry.updatedAt,
          message: `State stored at ${namespace}/${key} (version ${entry.version})`,
        });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── ops_state_cas ─────────────────────────────────────────
  server.tool(
    "ops_state_cas",
    "Atomic compare-and-swap: only updates if the current version matches expectedVersion. Use this for safe concurrent writes. Pattern: 1) ops_state_get → 2) compute new value → 3) ops_state_cas with version → retry on conflict.",
    {
      namespace: z.string().min(1).describe("Namespace of the key"),
      key: z.string().min(1).describe("The key to update"),
      expectedVersion: z.number().int().positive().describe("The version you read with ops_state_get — update only proceeds if this matches"),
      value: z.record(z.string(), z.unknown()).describe("New value to store if versions match"),
      updatedBy: z.string().optional().describe("Optional attribution"),
    },
    async ({ namespace, key, expectedVersion, value, updatedBy }) => {
      try {
        const result = await client.casState(namespace, key, expectedVersion, value, updatedBy);
        if (isCasConflict(result)) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                conflict: true,
                error: "CAS_CONFLICT",
                expectedVersion: result.expectedVersion,
                actualVersion: result.actualVersion,
                message: `Version conflict: expected ${result.expectedVersion} but current version is ${result.actualVersion}. Fetch the latest value with ops_state_get and retry.`,
              }, null, 2),
            }],
            isError: true,
          };
        }
        return ok({
          success: true,
          namespace: result.namespace,
          key: result.key,
          value: result.value,
          version: result.version,
          updatedBy: result.updatedBy,
          updatedAt: result.updatedAt,
          message: `CAS succeeded. State at ${namespace}/${key} updated to version ${result.version}.`,
        });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── ops_state_list ────────────────────────────────────────
  server.tool(
    "ops_state_list",
    "List all keys stored in a namespace with their versions and last-updated timestamps.",
    {
      namespace: z.string().min(1).describe("Namespace to list keys from"),
    },
    async ({ namespace }) => {
      try {
        const result = await client.listState(namespace);
        return ok({
          success: true,
          namespace: result.namespace,
          count: result.count,
          keys: result.keys,
        });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── ops_state_delete ──────────────────────────────────────
  server.tool(
    "ops_state_delete",
    "Delete a key from the state store. Returns success even if the key did not exist (idempotent).",
    {
      namespace: z.string().min(1).describe("Namespace of the key to delete"),
      key: z.string().min(1).describe("The key to delete"),
    },
    async ({ namespace, key }) => {
      try {
        const deleted = await client.deleteState(namespace, key);
        return ok({
          success: true,
          deleted,
          namespace,
          key,
          message: deleted
            ? `Key "${key}" deleted from namespace "${namespace}"`
            : `Key "${key}" not found in namespace "${namespace}" (already deleted or never existed)`,
        });
      } catch (e) {
        return errResult(e);
      }
    }
  );
}
