import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentTools } from "../agents.js";
import type { GatewayClient } from "../../client.js";
import type { Config } from "../../config.js";

// Minimal McpServer mock — just captures tool registrations
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
  return {
    registerAgent: vi.fn(),
    sendHeartbeat: vi.fn(),
    getAgent: vi.fn(),
    listAgents: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
    casState: vi.fn(),
    listState: vi.fn(),
    deleteState: vi.fn(),
    ...overrides,
  } as unknown as GatewayClient;
}

const config: Config = { gatewayUrl: "http://gateway:3001", agentId: "default-agent" };

beforeEach(() => vi.clearAllMocks());

describe("ops_register", () => {
  it("registers an agent and returns agentId", async () => {
    const client = makeClient({
      registerAgent: vi.fn().mockResolvedValue({ id: "a1", name: "Lava", status: "online", registeredAt: "2026-01-01" }),
    });
    const server = makeServer();
    registerAgentTools(server, client, config);
    const result = await server._call("ops_register", { name: "Lava", tags: ["ai"] }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.agentId).toBe("a1");
    expect(client.registerAgent).toHaveBeenCalledWith({ name: "Lava", tags: ["ai"], meta: undefined });
  });

  it("returns isError on gateway error", async () => {
    const client = makeClient({ registerAgent: vi.fn().mockRejectedValue(new Error("500 Server Error")) });
    const server = makeServer();
    registerAgentTools(server, client, config);
    const result = await server._call("ops_register", { name: "X" }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain("500");
  });
});

describe("ops_heartbeat", () => {
  it("sends heartbeat with explicit agentId", async () => {
    const client = makeClient({ sendHeartbeat: vi.fn().mockResolvedValue(undefined) });
    const server = makeServer();
    registerAgentTools(server, client, config);
    const result = await server._call("ops_heartbeat", { agentId: "explicit-id", status: "online" }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.agentId).toBe("explicit-id");
    expect(client.sendHeartbeat).toHaveBeenCalledWith("explicit-id", "online");
  });

  it("uses AGENT_ID from config when agentId not provided", async () => {
    const client = makeClient({ sendHeartbeat: vi.fn().mockResolvedValue(undefined) });
    const server = makeServer();
    registerAgentTools(server, client, config);
    await server._call("ops_heartbeat", { status: "online" });
    expect(client.sendHeartbeat).toHaveBeenCalledWith("default-agent", "online");
  });

  it("returns error when no agentId and no AGENT_ID in config", async () => {
    const client = makeClient({ sendHeartbeat: vi.fn() });
    const server = makeServer();
    const cfgNoId: Config = { gatewayUrl: "http://gw", agentId: undefined };
    registerAgentTools(server, client, cfgNoId);
    const result = await server._call("ops_heartbeat", {}) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});

describe("ops_whoami", () => {
  it("returns agent info", async () => {
    const fakeAgent = { id: "a1", name: "Lava", status: "online", tags: [], meta: {}, lastSeen: null, registeredAt: "2026-01-01" };
    const client = makeClient({ getAgent: vi.fn().mockResolvedValue(fakeAgent) });
    const server = makeServer();
    registerAgentTools(server, client, config);
    const result = await server._call("ops_whoami", { agentId: "a1" }) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.agent.id).toBe("a1");
  });

  it("returns error when agent not found", async () => {
    const client = makeClient({ getAgent: vi.fn().mockRejectedValue(new Error("Agent not found: a1")) });
    const server = makeServer();
    registerAgentTools(server, client, config);
    const result = await server._call("ops_whoami", { agentId: "a1" }) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("returns error when no agentId provided and config has none", async () => {
    const client = makeClient({ getAgent: vi.fn() });
    const server = makeServer();
    const cfgNoId: Config = { gatewayUrl: "http://gw", agentId: undefined };
    registerAgentTools(server, client, cfgNoId);
    const result = await server._call("ops_whoami", {}) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});

describe("ops_list_agents", () => {
  it("returns list of agents", async () => {
    const agents = [{ id: "a1", name: "Lava", status: "online", lastSeen: null, registeredAt: "2026-01-01" }];
    const client = makeClient({ listAgents: vi.fn().mockResolvedValue(agents) });
    const server = makeServer();
    registerAgentTools(server, client, config);
    const result = await server._call("ops_list_agents", {}) as { content: Array<{ text: string }> };
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.count).toBe(1);
    expect(data.agents[0].id).toBe("a1");
  });

  it("returns error on gateway failure", async () => {
    const client = makeClient({ listAgents: vi.fn().mockRejectedValue(new Error("Gateway offline")) });
    const server = makeServer();
    registerAgentTools(server, client, config);
    const result = await server._call("ops_list_agents", {}) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});
