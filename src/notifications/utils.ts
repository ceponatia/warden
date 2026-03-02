export function getDashboardBaseUrl(): string {
  return (
    process.env.WARDEN_DASHBOARD_BASE_URL ?? "http://localhost:3333"
  ).replace(/\/$/, "");
}
