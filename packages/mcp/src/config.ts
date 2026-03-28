export interface Config {
  gatewayUrl: string;
  agentId: string | undefined;
}

export function loadConfig(): Config {
  const gatewayUrl = process.env.GATEWAY_URL;
  if (!gatewayUrl) {
    throw new Error(
      "GATEWAY_URL environment variable is required.\n" +
        "Set it to the URL of your agent-ops-gateway, e.g. http://localhost:3001"
    );
  }

  return {
    gatewayUrl: gatewayUrl.replace(/\/$/, ""), // strip trailing slash
    agentId: process.env.AGENT_ID,
  };
}
