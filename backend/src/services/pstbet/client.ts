/**
 * PstBet POS Web API client.
 * Spec: Authentication → Check account → Top-up account.
 */

import { config, isPstBetConfigured } from "../../config/env";
import { normalizeMsisdn } from "../parsers/types";

const TOKEN_REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000; // refresh 1 day early
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class PstBetApiError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG" | "AUTH" | "NOT_FOUND" | "REJECTED" | "NETWORK" | "AMOUNT",
    public readonly status?: number
  ) {
    super(message);
    this.name = "PstBetApiError";
  }
}

export interface PstBetPunter {
  punterId: number;
  userName: string;
  mobile: string;
  firstName: string | null;
  lastName: string | null;
  balance: number | null;
}

export interface PstBetPaymentResult {
  userName: string;
  theirReference: string | null;
  ourReference: string | null;
  message: string | null;
}

type TokenCache = { token: string; expiresAt: number };

let tokenCache: TokenCache | null = null;

/** Convert stored MSISDN (264…) to PstBet local format (0…). */
export function toPstBetMobile(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.startsWith("0") && digits.length >= 9 && digits.length <= 12) return digits;
  const normalized = normalizeMsisdn(raw);
  if (!normalized) return null;
  if (normalized.startsWith("264") && normalized.length >= 11) {
    return `0${normalized.slice(3)}`;
  }
  if (normalized.startsWith("0")) return normalized;
  return null;
}

function assertConfigured(): void {
  if (!isPstBetConfigured()) {
    throw new PstBetApiError(
      "PstBet is not configured (set PSTBET_USERNAME and PSTBET_PASSWORD)",
      "CONFIG"
    );
  }
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
  token?: string
): Promise<T> {
  const url = `${config.pstbet.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new PstBetApiError(
      e instanceof Error ? e.message : "PstBet network error",
      "NETWORK"
    );
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new PstBetApiError(
      `PstBet returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
      "NETWORK",
      res.status
    );
  }

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "message" in data && typeof (data as { message: unknown }).message === "string"
        ? (data as { message: string }).message
        : `PstBet HTTP ${res.status}`;
    throw new PstBetApiError(msg, res.status === 401 ? "AUTH" : "NETWORK", res.status);
  }

  return data as T;
}

interface TokenResponse {
  type: number;
  token?: string;
  message?: string;
}

interface AccountResponse {
  type: number;
  message?: string;
  punter?: {
    punterId?: number;
    userName?: string;
    mobile?: string;
    firstName?: string;
    lastName?: string;
    balance?: number;
  };
}

interface PaymentResponse {
  type: number;
  message?: string;
  trxDetail?: {
    userName?: string;
    theirReference?: string;
    ourReference?: string;
  };
}

async function fetchNewToken(): Promise<string> {
  assertConfigured();
  const data = await postJson<TokenResponse>("/token", {
    userName: config.pstbet.userName,
    password: config.pstbet.password,
  });
  if (data.type !== 1 || !data.token) {
    throw new PstBetApiError(data.message || "PstBet authentication failed", "AUTH");
  }
  tokenCache = {
    token: data.token,
    expiresAt: Date.now() + TOKEN_TTL_MS - TOKEN_REFRESH_BUFFER_MS,
  };
  return data.token;
}

export async function getPstBetToken(forceRefresh = false): Promise<string> {
  assertConfigured();
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  return fetchNewToken();
}

/** Clear cached token (e.g. after 401). */
export function clearPstBetTokenCache(): void {
  tokenCache = null;
}

async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getPstBetToken();
  try {
    return await fn(token);
  } catch (e) {
    if (e instanceof PstBetApiError && (e.code === "AUTH" || e.status === 401)) {
      clearPstBetTokenCache();
      const fresh = await getPstBetToken(true);
      return fn(fresh);
    }
    throw e;
  }
}

export async function checkPstBetAccount(mobileRaw: string): Promise<PstBetPunter> {
  const mobile = toPstBetMobile(mobileRaw);
  if (!mobile) {
    throw new PstBetApiError("Invalid mobile number for PstBet lookup", "NOT_FOUND");
  }

  return withAuth(async (token) => {
    const data = await postJson<AccountResponse>("/account", { mobile }, token);
    if (data.type !== 1 || !data.punter?.punterId || !data.punter.userName) {
      throw new PstBetApiError(data.message || "Betting account not found", "NOT_FOUND");
    }
    return {
      punterId: data.punter.punterId,
      userName: data.punter.userName,
      mobile: data.punter.mobile ?? mobile,
      firstName: data.punter.firstName ?? null,
      lastName: data.punter.lastName ?? null,
      balance: data.punter.balance != null ? Number(data.punter.balance) : null,
    };
  });
}

export async function topUpPstBetAccount(params: {
  userId: number;
  userName: string;
  mobile: string;
  amount: number;
  shopName?: string;
}): Promise<PstBetPaymentResult> {
  const mobile = toPstBetMobile(params.mobile) ?? params.mobile;
  const { minAmount, maxAmount, shopName } = config.pstbet;
  if (params.amount < minAmount || params.amount > maxAmount) {
    throw new PstBetApiError(
      `Amount must be between N$${minAmount} and N$${maxAmount}`,
      "AMOUNT"
    );
  }

  return withAuth(async (token) => {
    const data = await postJson<PaymentResponse>(
      "/payment",
      {
        userId: params.userId,
        userName: params.userName,
        mobile,
        amount: params.amount,
        shopName: params.shopName?.trim() || shopName,
      },
      token
    );

    // Spec: 1 success, 2 error, 99 failed
    if (data.type !== 1) {
      throw new PstBetApiError(data.message || "PstBet top-up failed", "REJECTED");
    }

    return {
      userName: data.trxDetail?.userName ?? params.userName,
      theirReference: data.trxDetail?.theirReference ?? null,
      ourReference: data.trxDetail?.ourReference ?? null,
      message: data.message ?? null,
    };
  });
}
