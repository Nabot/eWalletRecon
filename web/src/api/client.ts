import type {
  DepositEventDto,
  CaptureDeviceDto,
  CaptureDeviceActivityItem,
  AuditLogDto,
  AuditLogListDto,
  WalletTotalsDto,
  TopupRequestDto,
  DailyCloseoutDto,
  WalletProvider,
} from "@ewallet/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "";

function authHeaders(token: string | null): HeadersInit {
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function request<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type DepositFilters = {
  status?: string;
  provider?: string;
  walletNumberId?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
};

export type AuditFilters = {
  action?: string;
  actorType?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  before?: string;
};

function depositQuery(f: DepositFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.provider) p.set("provider", f.provider);
  if (f.walletNumberId) p.set("walletNumberId", f.walletNumberId);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.q) p.set("q", f.q);
  if (f.limit) p.set("limit", String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function auditQuery(f: AuditFilters): string {
  const p = new URLSearchParams();
  if (f.action) p.set("action", f.action);
  if (f.actorType) p.set("actorType", f.actorType);
  if (f.entityType) p.set("entityType", f.entityType);
  if (f.entityId) p.set("entityId", f.entityId);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.q) p.set("q", f.q);
  if (f.limit) p.set("limit", String(f.limit));
  if (f.before) p.set("before", f.before);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; staff: { id: string; email: string; role: "ADMIN" | "OPERATOR" } }>(
      "/api/auth/login",
      null,
      { method: "POST", body: JSON.stringify({ email, password }) }
    ),

  logout: (token: string) =>
    request<{ ok: true }>("/api/auth/logout", token, { method: "POST" }),

  deposits: (token: string, filters: DepositFilters = {}) =>
    request<DepositEventDto[]>(`/api/deposits${depositQuery(filters)}`, token),

  pendingCount: (token: string) =>
    request<{ count: number }>("/api/deposits/pending-count", token),

  exceptions: (token: string) => request<DepositEventDto[]>("/api/exceptions", token),

  devices: (token: string) => request<CaptureDeviceDto[]>("/api/devices", token),

  createDevice: (
    token: string,
    name: string,
    walletNumberId: string,
    extras?: { siteLabel?: string; holderName?: string; simMsisdn?: string; notes?: string }
  ) =>
    request<{
      id: string;
      name: string;
      walletNumberId: string;
      apiKey: string;
      provision: { v: number; apiBase: string; apiKey: string };
      provisionQrPayload: string;
    }>("/api/devices", token, {
      method: "POST",
      body: JSON.stringify({ name, walletNumberId, ...extras }),
    }),

  updateDevice: (
    token: string,
    id: string,
    patch: {
      name?: string;
      siteLabel?: string | null;
      holderName?: string | null;
      simMsisdn?: string | null;
      notes?: string | null;
      walletNumberId?: string;
    }
  ) =>
    request<CaptureDeviceDto>(`/api/devices/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  renameDevice: (token: string, id: string, name: string) =>
    request<CaptureDeviceDto>(`/api/devices/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  rotateDeviceKey: (token: string, id: string) =>
    request<{
      id: string;
      name: string;
      walletNumberId: string;
      apiKey: string;
      provision: { v: number; apiBase: string; apiKey: string };
      provisionQrPayload: string;
    }>(`/api/devices/${id}/rotate-key`, token, { method: "POST" }),

  showDeviceProvision: (token: string, id: string) =>
    request<{
      id: string;
      name: string;
      walletNumberId: string;
      apiKey: string;
      provision: { v: number; apiBase: string; apiKey: string };
      provisionQrPayload: string;
    }>(`/api/devices/${id}/provision`, token),

  forceDeviceSync: (token: string, id: string) =>
    request<CaptureDeviceDto>(`/api/devices/${id}/force-sync`, token, { method: "POST" }),

  pingDevice: (token: string, id: string) =>
    request<CaptureDeviceDto>(`/api/devices/${id}/ping`, token, { method: "POST" }),

  wipeDevice: (token: string, id: string) =>
    request<CaptureDeviceDto>(`/api/devices/${id}/wipe`, token, { method: "POST" }),

  deviceActivity: (token: string, id: string, limit = 8) =>
    request<CaptureDeviceActivityItem[]>(`/api/devices/${id}/activity?limit=${limit}`, token),

  deviceAudit: (token: string, id: string, limit = 12) =>
    request<AuditLogDto[]>(`/api/devices/${id}/audit?limit=${limit}`, token),

  revokeDevice: (token: string, id: string) =>
    request<{ ok: true; id: string }>(`/api/devices/${id}`, token, { method: "DELETE" }),

  wallets: (token: string) =>
    request<
      {
        id: string;
        msisdn: string;
        label: string;
        provider: WalletProvider;
        device?: { id: string; name: string; lastSeenAt: string | null } | null;
      }[]
    >("/api/wallets", token),

  renameWallet: (token: string, id: string, label: string) =>
    request<{
      id: string;
      msisdn: string;
      label: string;
      provider: WalletProvider;
      device?: { id: string; name: string; lastSeenAt: string | null } | null;
    }>(`/api/wallets/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),

  walletTotals: (token: string, period: "day" | "week") =>
    request<WalletTotalsDto[]>(`/api/reports/wallet-totals?period=${period}`, token),

  dailyCloseout: (token: string, date: string, period: "day" | "week" = "day") =>
    request<DailyCloseoutDto>(
      `/api/reports/daily-closeout?date=${encodeURIComponent(date)}&period=${period}`,
      token
    ),

  audit: (token: string, filters: AuditFilters = {}) =>
    request<AuditLogListDto>(`/api/audit${auditQuery({ limit: 100, ...filters })}`, token),

  auditExportCsvUrl: (filters: AuditFilters = {}) =>
    `${API_URL}/api/audit/export.csv${auditQuery(filters)}`,

  topups: (token: string, q?: string, status = "AWAITING") =>
    request<TopupRequestDto[]>(
      `/api/topups?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      token
    ),

  users: (token: string, q: string) =>
    request<{ id: string; name: string; betAccountId: string; registeredMsisdn: string }[]>(
      `/api/users?q=${encodeURIComponent(q)}`,
      token
    ),

  markCredited: (token: string, depositId: string, betAccountId: string, note?: string) =>
    request(`/api/deposits/${depositId}/mark-credited`, token, {
      method: "POST",
      body: JSON.stringify({ betAccountId, note: note || null }),
    }),

  uncredit: (token: string, depositId: string, reason?: string) =>
    request(`/api/deposits/${depositId}/uncredit`, token, {
      method: "POST",
      body: JSON.stringify({ reason: reason || null }),
    }),

  exportCsvUrl: (filters: { from?: string; to?: string; walletNumberId?: string }) => {
    const p = new URLSearchParams();
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.walletNumberId) p.set("walletNumberId", filters.walletNumberId);
    return `${API_URL}/api/deposits/export.csv?${p.toString()}`;
  },
};

export function formatNad(amount: number): string {
  return `N$ ${amount.toLocaleString("en-NA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pending age helpers */
export function pendingAgeMs(receivedAt: string): number {
  return Date.now() - new Date(receivedAt).getTime();
}

export function ageingClass(d: DepositEventDto): string {
  if (d.matchStatus === "MATCHED") return "";
  const h = pendingAgeMs(d.receivedAt) / 3_600_000;
  if (h >= 24) return "bg-[#FDE8EC]";
  if (h >= 2) return "bg-[#FFF8E1]";
  return "";
}

export function ageingLabel(d: DepositEventDto): string | null {
  if (d.matchStatus === "MATCHED") return null;
  const h = pendingAgeMs(d.receivedAt) / 3_600_000;
  if (h >= 24) return ">24h";
  if (h >= 2) return ">2h";
  return null;
}
