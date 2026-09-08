import type { DepositEventDto, CaptureDeviceDto, AuditLogDto, WalletTotalsDto, TopupRequestDto, DailyCloseoutDto, WalletProvider } from "@ewallet/shared";

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

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; staff: { id: string; email: string; role: "ADMIN" | "OPERATOR" } }>(
      "/api/auth/login",
      null,
      { method: "POST", body: JSON.stringify({ email, password }) }
    ),

  deposits: (token: string, filters: DepositFilters = {}) =>
    request<DepositEventDto[]>(`/api/deposits${depositQuery(filters)}`, token),

  pendingCount: (token: string) =>
    request<{ count: number }>("/api/deposits/pending-count", token),

  exceptions: (token: string) => request<DepositEventDto[]>("/api/exceptions", token),

  devices: (token: string) => request<CaptureDeviceDto[]>("/api/devices", token),

  wallets: (token: string) =>
    request<
      {
        id: string;
        msisdn: string;
        label: string;
        provider: WalletProvider;
      }[]
    >("/api/wallets", token),

  walletTotals: (token: string, period: "day" | "week") =>
    request<WalletTotalsDto[]>(`/api/reports/wallet-totals?period=${period}`, token),

  dailyCloseout: (token: string, date: string, period: "day" | "week" = "day") =>
    request<DailyCloseoutDto>(
      `/api/reports/daily-closeout?date=${encodeURIComponent(date)}&period=${period}`,
      token
    ),

  audit: (token: string) => request<AuditLogDto[]>("/api/audit", token),

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
