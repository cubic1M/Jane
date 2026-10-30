// Shared by the demo video's config, recorder and run script.

export const DEMO_PORT = Number(process.env.DEMO_PORT ?? 3790);
export const DEMO_AUTH_SECRET = "demo-video-only-auth-secret-not-for-production";

// The scratch database only: a local Postgres, never a hosted one.
export function demoDatabaseUrl(): string {
  const url =
    process.env.DEMO_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:55432/jane_demo_video";
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`DEMO_DATABASE_URL must be a local scratch database, not ${host}`);
  }
  return url;
}
