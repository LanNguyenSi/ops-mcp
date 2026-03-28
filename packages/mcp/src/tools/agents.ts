import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GatewayClient } from "../client.js";
import type { Config } from "../config.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2) }],
    isError: true,
  };
}

export function registerAgentTools(
  server: McpServer,
  client: GatewayClient,
  config: Config
): void {
  // ── ops_register ──────────────────────────────────────────
  server.tool(
    "ops_register",
    "Register a new agent with the Triologue agent-ops gateway. Call this at startup to get an agent ID.",
    {
      name: z.string().min(1).describe("Human-readable name for this agent"),
      tags: z.array(z.string()).optional().describe("Capability/category tags, e.g. [\"analyze\", \"summarize\"]"),
      meta: z.record(z.string(), z.unknown()).optional().describe("Optional metadata to store with the registration"),
    },
    async ({ name, tags, meta }) => {
      try {
        const result = await client.registerAgent({ name, tags, meta });
        return ok({
          success: true,
          agentId: result.id,
          name: result.name,
          status: result.status,
          registeredAt: result.registeredAt,
          message: `Agent "${name}" registered successfully with ID: ${result.id}`,
        });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── ops_heartbeat ─────────────────────────────────────────
  server.tool(
    "ops_heartbeat",
    "Send a heartbeat to the gateway to keep the agent marked as active. Call every 30-60 seconds.",
    {
      agentId: z.string().optional().describe("Agent ID to send heartbeat for. Defaults to AGENT_ID env var if set."),
      status: z.enum(["online", "busy", "idle"]).optional().default("online").describe("Current agent status"),
    },
    async ({ agentId, status }) => {
      const resolvedId = agentId ?? config.agentId;
      if (!resolvedId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "agentId is required (or set AGENT_ID environment variable)" }) }],
          isError: true as const,
        };
      }
      try {
        await client.sendHeartbeat(resolvedId, status ?? "online");
        return ok({
          success: true,
          agentId: resolvedId,
          status: status ?? "online",
          sentAt: new Date().toISOString(),
        });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── ops_whoami ────────────────────────────────────────────
  server.tool(
    "ops_whoami",
    "Get registration info and current status of an agent.",
    {
      agentId: z.string().optional().describe("Agent ID to look up. Defaults to AGENT_ID env var if set."),
    },
    async ({ agentId }) => {
      const resolvedId = agentId ?? config.agentId;
      if (!resolvedId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "agentId is required (or set AGENT_ID environment variable)" }) }],
          isError: true as const,
        };
      }
      try {
        const agent = await client.getAgent(resolvedId);
        return ok({
          success: true,
          agent: {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            tags: agent.tags,
            meta: agent.meta,
            lastSeen: agent.lastSeen,
            registeredAt: agent.registeredAt,
          },
        });
      } catch (e) {
        return err(e);
      }
    }
  );

  // ── ops_list_agents ───────────────────────────────────────
  server.tool(
    "ops_list_agents",
    "List all agents registered with the gateway.",
    {},
    async () => {
      try {
        const agents = await client.listAgents();
        return ok({
          success: true,
          count: agents.length,
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            lastSeen: a.lastSeen,
            registeredAt: a.registeredAt,
          })),
        });
      } catch (e) {
        return err(e);
      }
    }
  );
}
