/*
 * OpenShield REST + WS client for `openshield serve` (default 127.0.0.1:9310).
 *
 * Ported from the OpenShield Desktop backend client, keeping the same
 * contract: every call returns a discriminated Result, a bearer token is sent
 * on every request (including loopback), WS upgrades carry ?token=, a 401 means
 * "re-pair" and a 429 means pairing is rate-limited. Svelte stores and Tauri
 * hooks are dropped: here the config is passed in explicitly so the same code
 * runs in the background worker, the popup and the options page.
 */

export interface BackendConfig {
  host: string;
  port: number;
  token: string;
}

export type Result<T> = { success: true; data: T } | { success: false; error: string; status?: number };

export interface HealthReport {
  status?: string;
  version?: string;
  model?: string;
  [key: string]: unknown;
}

export interface SessionSummary {
  id: string;
  title?: string;
  model?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface SessionMessage {
  role: string;
  content: string;
  created_at?: string;
}

export interface PendingApproval {
  id: string;
  session: string;
  risk: string;
  tool: string;
  args: unknown;
  reason: string;
  created_at: string;
}

export interface WsEnvelope {
  type: string;
  session?: string;
  data?: Record<string, unknown>;
  message?: string;
  model?: string;
}

export type WireDecision = "approve" | "reject" | "approve_always";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 9310;
export const UNAUTHORIZED_ERROR = "Unauthorized — re-pair with your OpenShield server";
export const PAIR_RATE_LIMIT_ERROR = "Too many pairing attempts, wait a minute";
export const TOKEN_REQUIRED_ERROR = "A bearer token is required.";

const LOCAL_TIMEOUT_MS = 1500;
const REMOTE_TIMEOUT_MS = 8000;

export function defaultConfig(): BackendConfig {
  return { host: DEFAULT_HOST, port: DEFAULT_PORT, token: "" };
}

export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

/** RFC1918 / link-local / .local hosts. Anything else is refused (never expose 9310 publicly). */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (isLocalHost(h) || h.endsWith(".local") || h.endsWith(".lan")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Validate + normalise a config (same rules as Desktop's saveConfig, plus loopback/LAN only). */
export function validateConfig(next: BackendConfig): Result<BackendConfig> {
  const host = next.host.trim();
  if (!host) return { success: false, error: "Host is required." };
  if (!/^[a-zA-Z0-9.\-]+$/.test(host) && !/^\[[0-9a-fA-F:]+\]$/.test(host)) {
    return { success: false, error: "Host looks invalid (use an IP or hostname)." };
  }
  if (!isPrivateHost(host)) {
    return { success: false, error: "Only loopback or LAN hosts are allowed. Never expose openshield serve to the internet." };
  }
  if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) {
    return { success: false, error: "Port must be an integer between 1 and 65535." };
  }
  if (!next.token.trim()) return { success: false, error: TOKEN_REQUIRED_ERROR };
  return { success: true, data: { host, port: next.port, token: next.token.trim() } };
}

export function baseHttp(c: BackendConfig): string {
  return `http://${c.host}:${c.port}`;
}

export function baseWs(c: BackendConfig): string {
  return `ws://${c.host}:${c.port}`;
}

/** Host-permission match pattern for this server (ports are not part of match patterns). */
export function originPattern(c: Pick<BackendConfig, "host">): string {
  return `http://${c.host}/*`;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OpenShieldClient {
  constructor(
    public config: BackendConfig,
    private fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  async request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
    const c = this.config;
    if (!c.token) return { success: false, error: TOKEN_REQUIRED_ERROR };
    try {
      const res = await this.fetchImpl(`${baseHttp(c)}${path}`, {
        ...init,
        headers: {
          ...((init?.headers as Record<string, string>) ?? {}),
          Accept: "application/json",
          Authorization: `Bearer ${c.token}`,
        },
        signal: AbortSignal.timeout(isLocalHost(c.host) ? LOCAL_TIMEOUT_MS : REMOTE_TIMEOUT_MS),
      });
      if (res.status === 401) return { success: false, error: UNAUTHORIZED_ERROR, status: 401 };
      if (res.status === 429) return { success: false, error: PAIR_RATE_LIMIT_ERROR, status: 429 };
      if (!res.ok) return { success: false, error: `HTTP ${res.status} from ${path}`, status: res.status };
      return { success: true, data: (await res.json()) as T };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Network request failed" };
    }
  }

  health() {
    return this.request<HealthReport>("/api/v1/health");
  }

  async sessions(): Promise<Result<SessionSummary[]>> {
    const r = await this.request<unknown>("/api/v1/sessions");
    if (!r.success) return r;
    return { success: true, data: unwrapList<SessionSummary>(r.data, "sessions") };
  }

  createSession() {
    return this.request<{ id: string }>("/api/v1/sessions", { method: "POST" });
  }

  async messages(id: string): Promise<Result<SessionMessage[]>> {
    const r = await this.request<unknown>(`/api/v1/sessions/${encodeURIComponent(id)}/messages`);
    if (!r.success) return r;
    return { success: true, data: unwrapList<SessionMessage>(r.data, "messages") };
  }

  async approvals(): Promise<Result<PendingApproval[]>> {
    const r = await this.request<unknown>("/api/v1/approvals");
    if (!r.success) return r;
    return { success: true, data: unwrapList<PendingApproval>(r.data, "approvals") };
  }

  resolveApproval(id: string, decision: WireDecision) {
    return this.request<unknown>(`/api/v1/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
  }

  chatSocketUrl(): string {
    return `${baseWs(this.config)}/ws/v1/chat?token=${encodeURIComponent(this.config.token)}`;
  }
}

/** Server returns either a bare array or `{ <key>: [...] }`; accept both. */
export function unwrapList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, T[]>)[key];
  }
  return [];
}

export function parseEnvelope(raw: unknown): WsEnvelope | null {
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === "object" && typeof v.type === "string" ? (v as WsEnvelope) : null;
  } catch {
    return null;
  }
}

/** Exponential reconnect backoff with a cap (ms). */
export function backoffMs(attempt: number, base = 1000, cap = 30000): number {
  return Math.min(cap, base * 2 ** Math.max(0, attempt));
}
