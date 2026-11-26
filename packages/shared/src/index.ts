/** Shared types and constants for CU agent, dashboard, and API clients. */

export const API_VERSION = "v1" as const;
export const DEFAULT_RETENTION_DAYS = 15 as const;

export const RETENTION_OPTIONS_DAYS = [1, 3, 7, 15, 30, 60, 90] as const;

export type DeviceStatus = "online" | "offline" | "unknown";
export type OsFamily = "macos" | "windows";
export type MonitoringAuthStatus = "authorized" | "withdrawn" | "pending";

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  service: string;
  version: string;
  timestamp: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  employeeId: string | null;
  os: OsFamily;
  osVersion: string;
  agentVersion: string;
  status: DeviceStatus;
  monitoringAuthorization: MonitoringAuthStatus;
  lastSeenAt: string | null;
  registeredAt: string;
}

export interface ActivityStats {
  deviceId: string;
  activeSeconds: number;
  idleSeconds: number;
  keystrokeCount: number;
  from: string;
  to: string;
}
