import crypto from "crypto";

export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function generateApiKey(): string {
  return `ewc_${crypto.randomBytes(24).toString("hex")}`;
}

export function generateRefCode(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `BET${n}`;
}
