import { describe, expect, it } from "vitest";
import { toPstBetMobile } from "../../src/services/pstbet/client";

describe("toPstBetMobile", () => {
  it("converts 264 international to local 0-prefix", () => {
    expect(toPstBetMobile("264811600013")).toBe("0811600013");
    expect(toPstBetMobile("+264811600013")).toBe("0811600013");
  });

  it("keeps local 0-prefix numbers", () => {
    expect(toPstBetMobile("0811600013")).toBe("0811600013");
  });

  it("returns null for empty / invalid", () => {
    expect(toPstBetMobile(null)).toBeNull();
    expect(toPstBetMobile("")).toBeNull();
    expect(toPstBetMobile("abc")).toBeNull();
  });
});
