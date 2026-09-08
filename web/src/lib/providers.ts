import type { WalletProvider } from "@ewallet/shared";

const PROVIDER_LABEL: Record<WalletProvider, string> = {
  PAYPULSE: "PayPulse / BlueVoucher",
  EASYWALLET: "EasyWallet",
  PAY2CELL: "Pay2Cell",
  EWALLET: "FNB eWallet",
};

export function providerLabel(provider: WalletProvider | string): string {
  return PROVIDER_LABEL[provider as WalletProvider] ?? provider;
}
