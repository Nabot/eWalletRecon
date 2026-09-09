/** Shared types for e-wallet reconciliation (backend + web). */

export type WalletProvider =
  | "PAYPULSE"
  | "EASYWALLET"
  | "PAY2CELL"
  | "EWALLET"
  | "BANK_WHK"
  | "BANK_STDBANK";

export type DepositChannel = "WALLET" | "BANK";

export type MatchStatus = "PENDING" | "MATCHED" | "UNMATCHED" | "MANUAL";

export type TopupStatus = "AWAITING" | "FULFILLED" | "EXPIRED";

export type StaffRole = "ADMIN" | "OPERATOR";

export type ActorType = "STAFF" | "DEVICE" | "SYSTEM";

export interface NormalizedDeposit {
  provider: WalletProvider;
  amount: number;
  currency: "NAD";
  senderMsisdn: string | null;
  senderName?: string | null;
  reference: string | null;
  receivedAt: string; // ISO
  rawMessage: string;
  /** Optional external id when source is webhook/merchant API */
  externalId?: string | null;
  source: DepositSource;
  channel?: DepositChannel;
}

export type DepositSource = "SMS" | "WEBHOOK" | "MANUAL";

export interface ParsedSms {
  amount: number;
  senderMsisdn: string | null;
  senderName: string | null;
  reference: string | null;
  timestamp: Date | null;
}

export interface MatchResult {
  status: MatchStatus;
  topupRequestId: string | null;
  reason: string;
  credited: boolean;
}

export type CreditProvider = "MANUAL" | "PSTBET";

export interface DepositEventDto {
  id: string;
  walletNumberId: string;
  provider: WalletProvider;
  channel: DepositChannel;
  amount: number;
  currency: string;
  senderMsisdn: string | null;
  senderName: string | null;
  reference: string | null;
  rawMessage: string;
  receivedAt: string;
  matchStatus: MatchStatus;
  matchedTopupRequestId: string | null;
  creditBetAccountId: string | null;
  creditNote: string | null;
  creditedAt: string | null;
  creditedByStaffId: string | null;
  creditProvider: CreditProvider | string | null;
  pstbetOurReference: string | null;
  pstbetTheirReference: string | null;
  creditError: string | null;
  createdAt: string;
  walletNumber?: {
    msisdn: string;
    label: string;
    provider: WalletProvider;
  };
}

export interface PstBetStatusDto {
  configured: boolean;
  shopName: string | null;
  minAmount: number;
  maxAmount: number;
}

export interface PstBetPunterDto {
  punterId: number;
  userName: string;
  mobile: string;
  firstName: string | null;
  lastName: string | null;
  balance: number | null;
}

export interface PstBetLookupDto {
  depositId: string;
  amount: number;
  currency: string;
  senderMsisdn: string | null;
  mobile: string;
  punter: PstBetPunterDto;
  amountInRange: boolean;
  minAmount: number;
  maxAmount: number;
}

export interface PstBetCreditOutcomeDto {
  status: MatchStatus;
  credited: boolean;
  reason: string;
  ourReference: string | null;
  theirReference: string | null;
  betAccountId: string;
}

export interface DailyCloseoutDto {
  date: string;
  period?: "day" | "week";
  from?: string;
  to?: string;
  wallets: {
    walletNumberId: string;
    msisdn: string;
    label: string;
    provider: WalletProvider;
    receivedCount: number;
    receivedAmount: number;
    creditedCount: number;
    creditedAmount: number;
    pendingCount: number;
    pendingAmount: number;
  }[];
  totals: {
    receivedCount: number;
    receivedAmount: number;
    creditedCount: number;
    creditedAmount: number;
    pendingCount: number;
    pendingAmount: number;
  };
}

export interface TopupRequestDto {
  id: string;
  userId: string;
  betAccountId: string;
  expectedAmount: number | null;
  refCode: string;
  status: TopupStatus;
  expiresAt: string;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    registeredMsisdn: string;
    betAccountId: string;
  };
}

export interface CaptureDeviceDto {
  id: string;
  name: string;
  walletNumberId: string;
  lastSeenAt: string | null;
  online: boolean;
  /** Offline longer than alert threshold */
  offlineAlert: boolean;
  /** Pending SMS queue above alert threshold */
  queueAlert: boolean;
  /** Reported versionCode below server minimum */
  updateRequired: boolean;
  notes: string | null;
  siteLabel: string | null;
  holderName: string | null;
  simMsisdn: string | null;
  appVersionName: string | null;
  appVersionCode: number | null;
  pendingSmsCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  smsPermissionOk: boolean | null;
  syncRequested: boolean;
  wipeRequested: boolean;
  pingRequested: boolean;
  lastPongAt: string | null;
  /** True while a one-time provision key can still be re-shown */
  hasPendingProvision: boolean;
  walletNumber?: {
    msisdn: string;
    label: string;
    provider: WalletProvider;
  };
}

export interface CaptureDeviceActivityItem {
  id: string;
  amount: number;
  currency: string;
  matchStatus: MatchStatus;
  senderName: string | null;
  senderMsisdn: string | null;
  reference: string | null;
  rawMessage: string;
  receivedAt: string;
  source: DepositSource;
}

export interface AuditLogDto {
  id: string;
  actorType: ActorType;
  actorId: string;
  /** Resolved display name (e.g. staff email, device name) when available */
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Paginated audit list (`before` cursor = oldest createdAt on the current page). */
export interface AuditLogListDto {
  items: AuditLogDto[];
  nextBefore: string | null;
}

export interface WalletTotalsDto {
  walletNumberId: string;
  msisdn: string;
  label: string;
  provider: WalletProvider;
  period: "day" | "week";
  totalAmount: number;
  depositCount: number;
  matchedCount: number;
  unmatchedCount: number;
  manualCount: number;
}

/** WebSocket / SSE event payloads */
export type RealtimeEvent =
  | { type: "deposit.created"; payload: DepositEventDto }
  | { type: "deposit.updated"; payload: DepositEventDto }
  | { type: "device.heartbeat"; payload: CaptureDeviceDto }
  | { type: "audit.created"; payload: { id: string; action: string } };
