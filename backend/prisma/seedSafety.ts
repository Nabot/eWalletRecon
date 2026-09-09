/**
 * Guard against wiping remote/production DBs with `npm run db:seed`.
 * Seed runs deleteMany on wallets, deposits, devices, users, and staff.
 */

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
  "mysql", // docker-compose service name
]);

const REMOTE_HOST_MARKERS = [
  "ondigitalocean.com",
  "rds.amazonaws.com",
  "azure.com",
  "googleapis.com",
  "render.com",
  "neon.tech",
  "supabase.co",
  "planetscale.com",
  "db.cloud",
];

export const DESTRUCTIVE_SEED_CONFIRM = "I_UNDERSTAND_DELETE_ALL_DATA";

export function parseDatabaseHost(databaseUrl: string | undefined): string | null {
  if (!databaseUrl?.trim()) return null;
  try {
    const normalized = databaseUrl.replace(/^mysql:\/\//i, "http://");
    return new URL(normalized).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function isLocalDatabaseHost(host: string | null): boolean {
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

export function looksLikeManagedRemoteHost(host: string | null): boolean {
  if (!host) return false;
  return REMOTE_HOST_MARKERS.some((m) => host === m || host.endsWith(`.${m}`) || host.includes(m));
}

/**
 * Throws if seeding would be unsafe.
 * Escape hatch (local emergencies / intentional wipe): ALLOW_DESTRUCTIVE_SEED=I_UNDERSTAND_DELETE_ALL_DATA
 */
export function assertSafeToSeed(env: NodeJS.ProcessEnv = process.env): void {
  const url = env.DATABASE_URL;
  const host = parseDatabaseHost(url);
  const forced = env.ALLOW_DESTRUCTIVE_SEED === DESTRUCTIVE_SEED_CONFIRM;
  const nodeEnv = (env.NODE_ENV ?? "").toLowerCase();

  if (forced) {
    console.warn(
      "[seed] ALLOW_DESTRUCTIVE_SEED is set — proceeding with a full wipe of wallets/deposits/devices/users.",
    );
    return;
  }

  if (nodeEnv === "production") {
    throw new Error(
      [
        "Refusing to seed: NODE_ENV=production.",
        "Seed deletes all wallets, deposits, devices, users, and staff.",
        `To override (dangerous): ALLOW_DESTRUCTIVE_SEED=${DESTRUCTIVE_SEED_CONFIRM}`,
      ].join(" "),
    );
  }

  if (!host) {
    throw new Error(
      "Refusing to seed: DATABASE_URL is missing or invalid. Point it at local Docker MySQL (localhost).",
    );
  }

  if (looksLikeManagedRemoteHost(host) || !isLocalDatabaseHost(host)) {
    throw new Error(
      [
        `Refusing to seed: DATABASE_URL host "${host}" is not a local database.`,
        "Seed is for local Docker MySQL only (localhost / 127.0.0.1 / mysql).",
        "Do not put production DigitalOcean MySQL in backend/.env for day-to-day work.",
        `Override only if you intentionally wipe that DB: ALLOW_DESTRUCTIVE_SEED=${DESTRUCTIVE_SEED_CONFIRM}`,
      ].join(" "),
    );
  }
}
