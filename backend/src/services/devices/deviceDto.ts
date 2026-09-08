import type { CaptureDevice, WalletNumber, WalletProvider } from "@prisma/client";
import type { CaptureDeviceDto } from "@ewallet/shared";
import { config } from "../../config/env";

type DeviceRow = CaptureDevice & {
  walletNumber?: Pick<WalletNumber, "msisdn" | "label" | "provider">;
};

export function toDeviceDto(d: DeviceRow, now = Date.now()): CaptureDeviceDto {
  const offlineMs = config.deviceOfflineMinutes * 60 * 1000;
  const alertMs = config.deviceOfflineAlertMinutes * 60 * 1000;
  const online = d.lastSeenAt != null && now - d.lastSeenAt.getTime() < offlineMs;
  const offlineAlert = d.lastSeenAt == null || now - d.lastSeenAt.getTime() >= alertMs;
  const queueAlert = d.pendingSmsCount >= config.deviceQueueAlertCount;
  const updateRequired =
    config.minCaptureVersionCode > 0 &&
    (d.appVersionCode == null || d.appVersionCode < config.minCaptureVersionCode);

  return {
    id: d.id,
    name: d.name,
    walletNumberId: d.walletNumberId,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    online,
    offlineAlert,
    queueAlert,
    updateRequired,
    notes: d.notes ?? null,
    siteLabel: d.siteLabel ?? null,
    holderName: d.holderName ?? null,
    simMsisdn: d.simMsisdn ?? null,
    appVersionName: d.appVersionName ?? null,
    appVersionCode: d.appVersionCode ?? null,
    pendingSmsCount: d.pendingSmsCount,
    lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
    lastError: d.lastError ?? null,
    lastErrorAt: d.lastErrorAt?.toISOString() ?? null,
    smsPermissionOk: d.smsPermissionOk ?? null,
    syncRequested: d.syncRequestedAt != null,
    wipeRequested: d.wipeRequestedAt != null,
    pingRequested: d.pingRequestedAt != null,
    lastPongAt: d.lastPongAt?.toISOString() ?? null,
    hasPendingProvision: Boolean(d.pendingApiKey),
    walletNumber: d.walletNumber
      ? {
          msisdn: d.walletNumber.msisdn,
          label: d.walletNumber.label,
          provider: d.walletNumber.provider as WalletProvider,
        }
      : undefined,
  };
}

export async function maybePostDeviceAlert(text: string): Promise<void> {
  const url = config.alertWebhookUrl;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
    });
  } catch {
    // best-effort
  }
}
