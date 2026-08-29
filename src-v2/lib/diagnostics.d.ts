export interface DiagnosticEventInput {
  kind?: "ui.click" | "ui.change" | "ui.submit" | "ui.route" | "api.request" | "api.error" | "client.error";
  module?: string | null;
  action?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  traceId?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}

export const DIAGNOSTIC_INGEST_PATH: "/v1/web/diagnostics/events";
export function safeDiagnosticMessage(value: unknown): string | null;
export function normalizeDiagnosticPath(value: string, baseUrl?: string): {
  path: string;
  destination: string;
};
export function normalizeDiagnosticEvent(input?: DiagnosticEventInput, options?: {
  now?: () => string;
}): DiagnosticEventInput & {
  eventId: string;
  operation: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};
export function recordDiagnosticEvent(input: DiagnosticEventInput): void;
export function installBrowserDiagnostics(): () => void;
