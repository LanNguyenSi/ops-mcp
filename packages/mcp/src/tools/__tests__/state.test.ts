import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStateTools } from "../state.js";
import type { GatewayClient } from "../../client.js";
import type { Config } from "../../config.js";

function makeServer() {
  const tools: Record<string, (...args: unknown[]) => unknown> = {};
  const server = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools[name] = handler;
    }),
    _call: async (name: string, args: unknown) => (tools[name] as (a: unknown) => unknown)(args),
  };
  return server as unknown as McpServer & { _call: (n: string, a: unknown) => Promise<unknown> };
}

function makeClient(overrides: Partial<GatewayClient> = {}): GatewayClient {
  return { getState: vi.fn(), setState: vi.fn(), casState: vi.fn(), listState: vi.fn(), deleteState: vi.fn(), registerAgent: vi.fn(), sendHeartbeat: vi.fn(), getAgent: vi.fn(), listAgents: vi.fn(), ...overrides } as unknown as GatewayClient;
}

const config: Config = { gatewayUrl: "http://gw", agentId: "test" };
const fakeEntry = { id: "x", namespace: "ns", key: "k", value: { a: 1 }, version: 3, updatedBy: "bot", updatedAt: "2026-01-01", createdAt: "2026-01-01" };

beforeEach(() => vi.clearAllMocks());

describe("ops_state_get", () => {
  it("returns found=true + value when key exists", async () => {
    const client = makeClient({ getState: vi.fn().mockResolvedValue(fakeEntry) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_get", { namespace: "ns", key: "k" }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.found).toBe(true);
    expect(data.version).toBe(3);
    expect(data.value).toEqual({ a: 1 });
  });

  it("returns found=false when key not found (not an error)", async () => {
    const client = makeClient({ getState: vi.fn().mockResolvedValue(null) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_get", { namespace: "ns", key: "missing" }) as { content: Array<{ text: string }>; isError?: boolean };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.found).toBe(false);
    expect(data.value).toBeNull();
    expect(result.isError).toBeUndefined();
  });
});

describe("ops_state_set", () => {
  it("sets key and returns version", async () => {
    const client = makeClient({ setState: vi.fn().mockResolvedValue({ ...fakeEntry, version: 1 }) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_set", { namespace: "ns", key: "k", value: { a: 1 } }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.version).toBe(1);
    expect(data.message).toContain("version 1");
  });

  it("overwrites existing key (version increments)", async () => {
    const client = makeClient({ setState: vi.fn().mockResolvedValue({ ...fakeEntry, version: 4 }) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_set", { namespace: "ns", key: "k", value: { a: 2 } }) as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0].text).version).toBe(4);
  });
});

describe("ops_state_cas", () => {
  it("succeeds when version matches", async () => {
    const client = makeClient({ casState: vi.fn().mockResolvedValue({ ...fakeEntry, version: 4 }) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_cas", { namespace: "ns", key: "k", expectedVersion: 3, value: { a: 2 } }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.version).toBe(4);
  });

  it("returns isError+conflict details when version mismatches", async () => {
    const client = makeClient({
      casState: vi.fn().mockResolvedValue({ error: "CAS_CONFLICT", expectedVersion: 3, actualVersion: 5, message: "Version mismatch" }),
    });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_cas", { namespace: "ns", key: "k", expectedVersion: 3, value: {} }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.conflict).toBe(true);
    expect(data.actualVersion).toBe(5);
    expect(data.message).toContain("retry");
  });

  it("returns error when key not found", async () => {
    const client = makeClient({ casState: vi.fn().mockRejectedValue(new Error("NOT_FOUND")) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_cas", { namespace: "ns", key: "missing", expectedVersion: 1, value: {} }) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});

describe("ops_state_list", () => {
  it("returns keys in namespace", async () => {
    const client = makeClient({ listState: vi.fn().mockResolvedValue({ namespace: "ns", count: 2, keys: [{ key: "a", version: 1, updatedBy: null, updatedAt: "" }, { key: "b", version: 2, updatedBy: null, updatedAt: "" }] }) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_list", { namespace: "ns" }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);
    expect(data.keys).toHaveLength(2);
  });

  it("returns empty keys for empty namespace", async () => {
    const client = makeClient({ listState: vi.fn().mockResolvedValue({ namespace: "empty", count: 0, keys: [] }) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_list", { namespace: "empty" }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.count).toBe(0);
    expect(data.keys).toEqual([]);
  });
});

describe("ops_state_delete", () => {
  it("returns deleted=true when key existed", async () => {
    const client = makeClient({ deleteState: vi.fn().mockResolvedValue(true) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_delete", { namespace: "ns", key: "k" }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.deleted).toBe(true);
    expect(data.message).toContain("deleted");
  });

  it("returns deleted=false (no error) when key not found — idempotent", async () => {
    const client = makeClient({ deleteState: vi.fn().mockResolvedValue(false) });
    const server = makeServer();
    registerStateTools(server, client, config);
    const result = await server._call("ops_state_delete", { namespace: "ns", key: "gone" }) as { content: Array<{ text: string }>; isError?: boolean };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.deleted).toBe(false);
    expect(result.isError).toBeUndefined(); // not an error!
  });
});
