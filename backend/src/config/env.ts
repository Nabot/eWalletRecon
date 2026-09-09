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
  /** Banner / webhook when offline longer than this (defaults to offline window). */
  deviceOfflineAlertMinutes: Number(
    process.env.DEVICE_OFFLINE_ALERT_MINUTES ?? process.env.DEVICE_OFFLINE_MINUTES ?? 5
  ),
  /** Banner when handset reports pending SMS queue ≥ this count. */
  deviceQueueAlertCount: Number(process.env.DEVICE_QUEUE_ALERT_COUNT ?? 5),
  /** Phones below this versionCode show “Update required”. 0 = disabled. */
  minCaptureVersionCode: Number(process.env.MIN_CAPTURE_VERSION_CODE ?? 7),
  /** Optional Slack/Discord/generic webhook for phone alerts. */
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL?.trim() || null,
  nodeEnv: process.env.NODE_ENV ?? "development",

  /** PstBet POS API (optional — assisted credit disabled when unset). */
  pstbet: {
    baseUrl: (process.env.PSTBET_BASE_URL ?? "https://service.pstmobile.com.na/pos").replace(/\/$/, ""),
    userName: process.env.PSTBET_USERNAME?.trim() || null,
    password: process.env.PSTBET_PASSWORD?.trim() || null,
    shopName: process.env.PSTBET_SHOP_NAME?.trim() || "WalletRecon",
    minAmount: Number(process.env.PSTBET_MIN_AMOUNT ?? 5),
    maxAmount: Number(process.env.PSTBET_MAX_AMOUNT ?? 5000),
  },
};

export function isPstBetConfigured(): boolean {
  return Boolean(config.pstbet.userName && config.pstbet.password);
}
