import { describe, it, expect, vi, beforeEach } from "vitest";
import { GatewayClient } from "../client.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const config = { gatewayUrl: "http://gateway:3001", agentId: "test-agent" };
const client = new GatewayClient(config);

function mockResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    status,
    json: () => Promise.resolve(data),
  });
}

function mockNoContent(status = 204) {
  mockFetch.mockResolvedValueOnce({ status, json: () => Promise.resolve(null) });
}

beforeEach(() => vi.clearAllMocks());

describe("GatewayClient.registerAgent", () => {
  it("POSTs to /agents/register and returns result", async () => {
    const fakeResult = { id: "a1", name: "Lava", status: "online", registeredAt: "2026-01-01" };
    mockResponse(fakeResult, 201);
    const result = await client.registerAgent({ name: "Lava" });
    expect(result.id).toBe("a1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gateway:3001/agents/register",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on error response", async () => {
    mockResponse({ error: "CONFLICT" }, 409);
    await expect(client.registerAgent({ name: "X" })).rejects.toThrow("Register failed");
  });
});

describe("GatewayClient.listAgents", () => {
  it("GETs /agents and returns array", async () => {
    mockResponse([{ id: "a1", name: "Lava" }]);
    const agents = await client.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("a1");
  });

  it("returns empty array if response is not array", async () => {
    mockResponse({ agents: [] });
    const agents = await client.listAgents();
    expect(agents).toEqual([]);
  });
});

describe("GatewayClient.sendHeartbeat", () => {
  it("POSTs to /agents/:id/heartbeat", async () => {
    mockResponse({ ok: true });
    await client.sendHeartbeat("a1");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gateway:3001/agents/a1/heartbeat",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("GatewayClient state methods", () => {
  it("getState returns null on 404", async () => {
    mockResponse({ error: "NOT_FOUND" }, 404);
    const result = await client.getState("ns", "missing");
    expect(result).toBeNull();
  });

  it("getState returns entry on 200", async () => {
    const entry = { id: "x", namespace: "ns", key: "k", value: {}, version: 1, updatedBy: null, updatedAt: "", createdAt: "" };
    mockResponse(entry);
    const result = await client.getState("ns", "k");
    expect(result?.version).toBe(1);
  });

  it("setState PUTs to /api/state/:ns/:key", async () => {
    const entry = { id: "x", namespace: "ns", key: "k", value: { a: 1 }, version: 1, updatedBy: null, updatedAt: "", createdAt: "" };
    mockResponse(entry);
    const result = await client.setState("ns", "k", { a: 1 });
    expect(result.version).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gateway:3001/api/state/ns/k",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("deleteState returns true on 204", async () => {
    mockNoContent(204);
    const result = await client.deleteState("ns", "k");
    expect(result).toBe(true);
  });

  it("deleteState returns false on 404", async () => {
    mockResponse({ error: "NOT_FOUND" }, 404);
    const result = await client.deleteState("ns", "missing");
    expect(result).toBe(false);
  });
});
