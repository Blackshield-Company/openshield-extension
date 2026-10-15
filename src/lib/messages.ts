// Messages between popup/options and the background worker.
import type { PendingApproval, WireDecision } from "./client";

export type BgRequest =
  | { type: "status" }
  | { type: "reconnect" }
  | { type: "resolve"; id: string; decision: WireDecision }
  | { type: "setSession"; id: string | null };

export interface BgStatus {
  state: "unconfigured" | "connecting" | "connected" | "disconnected" | "unauthorized";
  ws: "open" | "closed";
  error: string | null;
  version?: string;
  approvals: PendingApproval[];
  currentSession: string | null;
}
