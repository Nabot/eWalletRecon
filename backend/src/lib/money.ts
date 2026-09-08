import { Decimal } from "@prisma/client/runtime/library";

/** Format NAD amounts for display: N$ 1,234.56 */
export function formatNad(amount: number | Decimal | string): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  return `N$ ${n.toLocaleString("en-NA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function toNumber(amount: Decimal | number | string): number {
  return typeof amount === "number" ? amount : Number(amount);
}

export function amountsEqual(a: Decimal | number | string, b: Decimal | number | string): boolean {
  return Math.abs(toNumber(a) - toNumber(b)) < 0.001;
}
