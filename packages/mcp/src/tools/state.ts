import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "../client.js";
import type { Config } from "../config.js";

/**
 * Register state-related MCP tools.
 * Implemented in Task 006.
 */
export function registerStateTools(
  _server: McpServer,
  _client: GatewayClient,
  _config: Config
): void {
  // Task 006: ops_state_get, ops_state_set, ops_state_cas, ops_state_list, ops_state_delete
}
