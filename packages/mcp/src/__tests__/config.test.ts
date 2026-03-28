import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when GATEWAY_URL is not set", () => {
    delete process.env.GATEWAY_URL;
    expect(() => loadConfig()).toThrow("GATEWAY_URL");
  });

  it("returns config with gatewayUrl and agentId", () => {
    process.env.GATEWAY_URL = "http://localhost:3001";
    process.env.AGENT_ID = "lava-agent";
    const config = loadConfig();
    expect(config.gatewayUrl).toBe("http://localhost:3001");
    expect(config.agentId).toBe("lava-agent");
  });

  it("strips trailing slash from gatewayUrl", () => {
    process.env.GATEWAY_URL = "http://localhost:3001/";
    const config = loadConfig();
    expect(config.gatewayUrl).toBe("http://localhost:3001");
  });

  it("agentId is undefined when AGENT_ID not set", () => {
    process.env.GATEWAY_URL = "http://localhost:3001";
    delete process.env.AGENT_ID;
    const config = loadConfig();
    expect(config.agentId).toBeUndefined();
  });
});
