import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "../client.js";
import type { Config } from "../config.js";

/**
 * Register agent-related MCP tools.
 * Implemented in Task 005.
 */
export function registerAgentTools(
  _server: McpServer,
  _client: GatewayClient,
  _config: Config
): void {
  // Task 005: ops_register, ops_heartbeat, ops_whoami, ops_list_agents
}
