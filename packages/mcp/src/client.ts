import type { Config } from "./config.js";
import type {
  Agent,
  RegisterAgentInput,
  RegisterAgentResult,
  StateEntry,
  StateListResult,
  CasConflictError,
} from "./types.js";

export class GatewayClient {
  constructor(private config: Config) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ data: T; status: number }> {
    const url = `${this.config.gatewayUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = res.status === 204 ? null : ((await res.json()) as T);
    return { data: data as T, status: res.status };
  }

  // ── Agent methods ────────────────────────────────────────

  async registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult> {
    const { data, status } = await this.request<RegisterAgentResult>(
      "POST",
      "/agents/register",
      input
    );
    if (status !== 201 && status !== 200) {
      throw new Error(`Register failed: ${JSON.stringify(data)}`);
    }
    return data;
  }

  async sendHeartbeat(agentId: string, status = "online"): Promise<void> {
    await this.request("POST", `/agents/${agentId}/heartbeat`, { status });
  }

  async getAgent(agentId: string): Promise<Agent> {
    const { data, status } = await this.request<Agent>(
      "GET",
      `/agents/${agentId}`
    );
    if (status === 404) throw new Error(`Agent not found: ${agentId}`);
    return data;
  }

  async listAgents(): Promise<Agent[]> {
    const { data } = await this.request<Agent[]>("GET", "/agents");
    return Array.isArray(data) ? data : [];
  }

  // ── State methods ────────────────────────────────────────

  async getState(
    namespace: string,
    key: string
  ): Promise<StateEntry | null> {
    const { data, status } = await this.request<StateEntry>(
      "GET",
      `/api/state/${namespace}/${key}`
    );
    if (status === 404) return null;
    return data;
  }

  async setState(
    namespace: string,
    key: string,
    value: Record<string, unknown>,
    updatedBy?: string
  ): Promise<StateEntry> {
    const { data } = await this.request<StateEntry>(
      "PUT",
      `/api/state/${namespace}/${key}`,
      { value, updatedBy }
    );
    return data;
  }

  async casState(
    namespace: string,
    key: string,
    expectedVersion: number,
    value: Record<string, unknown>,
    updatedBy?: string
  ): Promise<StateEntry | CasConflictError> {
    const { data } = await this.request<StateEntry | CasConflictError>(
      "POST",
      `/api/state/${namespace}/${key}/cas`,
      { expectedVersion, value, updatedBy }
    );
    return data;
  }

  async listState(namespace: string): Promise<StateListResult> {
    const { data } = await this.request<StateListResult>(
      "GET",
      `/api/state/${namespace}`
    );
    return data;
  }

  async deleteState(namespace: string, key: string): Promise<boolean> {
    const { status } = await this.request(
      "DELETE",
      `/api/state/${namespace}/${key}`
    );
    return status === 204;
  }
}
