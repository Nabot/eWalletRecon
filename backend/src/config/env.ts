import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: required("DATABASE_URL", "mysql://ewallet:ewallet@localhost:3306/ewallet_recon"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  /** Public base URL embedded in device provision QR (phones must reach this). */
  publicApiBaseUrl: (process.env.PUBLIC_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(
    /\/$/,
    ""
  ),
  matchTimeWindowMinutes: Number(process.env.MATCH_TIME_WINDOW_MINUTES ?? 15),
  deviceOfflineMinutes: Number(process.env.DEVICE_OFFLINE_MINUTES ?? 5),
  nodeEnv: process.env.NODE_ENV ?? "development",
};
