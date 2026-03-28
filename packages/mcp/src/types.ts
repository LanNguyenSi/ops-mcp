// Agent types (mirrors gateway models)
export interface Agent {
  id: string;
  name: string;
  status: "online" | "offline" | string;
  lastSeen: string | null;
  registeredAt: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface RegisterAgentInput {
  name: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface RegisterAgentResult {
  id: string;
  name: string;
  status: string;
  registeredAt: string;
}

// State types
export interface StateEntry {
  id: string;
  namespace: string;
  key: string;
  value: Record<string, unknown>;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface StateListResult {
  namespace: string;
  count: number;
  keys: Array<{
    key: string;
    version: number;
    updatedBy: string | null;
    updatedAt: string;
  }>;
}

export interface CasConflictError {
  error: "CAS_CONFLICT";
  expectedVersion: number;
  actualVersion: number;
  message: string;
}

// Event types
export interface AgentEvent {
  id: number;
  agentId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// MCP tool result helpers
export interface McpSuccess<T> {
  success: true;
  data: T;
}

export interface McpError {
  success: false;
  error: string;
  details?: unknown;
}

export type McpResult<T> = McpSuccess<T> | McpError;
