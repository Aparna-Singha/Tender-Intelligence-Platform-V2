const operationalPaths = new Set([
  "/health",
  "/ready",
  "/maintenance",
  "/maintenance/enable",
  "/maintenance/disable",
  "/maintenance/reconciliation",
]);

export function isOperationalPath(url: string): boolean {
  return operationalPaths.has(url.split("?", 1)[0] ?? "");
}

export function shouldRejectForMaintenance(
  url: string,
  enabled: boolean,
): boolean {
  return enabled && !isOperationalPath(url);
}
