import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "./config.js";
import { GatewayClient } from "./client.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerStateTools } from "./tools/state.js";

export async function createServer(config: Config): Promise<McpServer> {
  const server = new McpServer({
    name: "opentriologue",
    version: "0.1.0",
  });

  const client = new GatewayClient(config);

  // Register all tool groups
  registerAgentTools(server, client, config);
  registerStateTools(server, client, config);

  return server;
}

export async function startServer(config: Config): Promise<void> {
  const server = await createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until process exits
}
