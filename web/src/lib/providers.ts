import type { WalletProvider, DepositChannel } from "@ewallet/shared";

const PROVIDER_LABEL: Record<WalletProvider, string> = {
  PAYPULSE: "PayPulse / BlueVoucher",
  EASYWALLET: "EasyWallet",
  PAY2CELL: "Pay2Cell",
  EWALLET: "FNB eWallet",
  BANK_WHK: "Bank WHK",
};

export function providerLabel(provider: WalletProvider | string): string {
  return PROVIDER_LABEL[provider as WalletProvider] ?? provider;
}

export function channelLabel(channel: DepositChannel | string | null | undefined): string {
  if (channel === "BANK") return "Bank";
  return "Wallet";
}
