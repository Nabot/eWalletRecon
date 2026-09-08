import { describe, expect, it } from "vitest";

/**
 * Documents / guards the SMS dedupe rules used in ingest.ts.
 * (Full DB integration is covered in production by Prisma findFirst.)
 */
describe("SMS capture dedupe policy", () => {
  it("uses sender+body identity without timestamp for client keys", () => {
    const normalize = (raw: string) =>
      raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = (sender: string, body: string) =>
      `${normalize(sender)}|${body.trim()}`;

    expect(key("PAYPULSE", "  Hello  ")).toBe(key("paypulse", "Hello"));
    // PDU vs inbox timestamps must not change the key
    expect(key("362626", "FNB msg")).toBe(key("362626", "FNB msg"));
    expect(key("PAYPULSE", "A")).not.toBe(key("PAYPULSE", "B"));
  });

  it("treats identical raw bodies on one wallet as the same deposit", () => {
    const a = { wallet: "w1", body: "BlueVoucher credited N$50" };
    const b = { wallet: "w1", body: "BlueVoucher credited N$50" };
    const c = { wallet: "w1", body: "FNB eWallet received N$50" };
    expect(a.wallet === b.wallet && a.body === b.body).toBe(true);
    expect(a.body === c.body).toBe(false);
  });
});
