import { PrismaClient, WalletProvider, TopupStatus, StaffRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { assertSafeToSeed } from "./seedSafety";

const prisma = new PrismaClient();

function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

async function main() {
  // Hard stop: wipe sample data is for local Docker MySQL only.
  assertSafeToSeed();

  console.log("Seeding database...");

  await prisma.creditLedger.deleteMany();
  await prisma.depositEvent.deleteMany();
  await prisma.topupRequest.deleteMany();
  // AuditLog is append-only — never wipe (DB triggers + Prisma middleware enforce this).
  await prisma.captureDevice.deleteMany();
  await prisma.walletNumber.deleteMany();
  await prisma.user.deleteMany();
  await prisma.staffUser.deleteMany();

  const adminHash = await bcrypt.hash("admin123", 10);
  const operatorHash = await bcrypt.hash("operator123", 10);

  await prisma.staffUser.createMany({
    data: [
      { email: "admin@example.com", passwordHash: adminHash, role: StaffRole.ADMIN },
      { email: "operator@example.com", passwordHash: operatorHash, role: StaffRole.OPERATOR },
    ],
  });

  const wallets = await Promise.all([
    prisma.walletNumber.create({
      data: {
        msisdn: "264811000001",
        provider: WalletProvider.PAYPULSE,
        label: "PayPulse Main",
        active: true,
      },
    }),
    prisma.walletNumber.create({
      data: {
        msisdn: "264811000002",
        provider: WalletProvider.EASYWALLET,
        label: "EasyWallet Desk",
        active: true,
      },
    }),
    prisma.walletNumber.create({
      data: {
        msisdn: "264811000003",
        provider: WalletProvider.PAY2CELL,
        label: "Pay2Cell Ops",
        active: true,
      },
    }),
    prisma.walletNumber.create({
      data: {
        msisdn: "264811000004",
        provider: WalletProvider.EWALLET,
        label: "EWallet Backup",
        active: true,
      },
    }),
  ]);

  // Device API keys (plaintext shown once in seed output — store hashed)
  const deviceKeys = [
    { name: "Phone-PayPulse-1", walletNumberId: wallets[0].id, apiKey: "dev-device-paypulse-key-001" },
    { name: "Phone-EasyWallet-1", walletNumberId: wallets[1].id, apiKey: "dev-device-easywallet-key-001" },
  ];

  for (const d of deviceKeys) {
    await prisma.captureDevice.create({
      data: {
        name: d.name,
        walletNumberId: d.walletNumberId,
        apiKeyHash: hashApiKey(d.apiKey),
        lastSeenAt: new Date(),
      },
    });
    await prisma.walletNumber.update({
      where: { id: d.walletNumberId },
      data: { deviceId: d.name },
    });
  }

  const users = await Promise.all([
    prisma.user.create({
      data: {
        betAccountId: "BET-1001",
        registeredMsisdn: "264811111111",
        name: "Anna Nangolo",
      },
    }),
    prisma.user.create({
      data: {
        betAccountId: "BET-1002",
        registeredMsisdn: "264812222222",
        name: "John Shikongo",
      },
    }),
    prisma.user.create({
      data: {
        betAccountId: "BET-1003",
        registeredMsisdn: "264813333333",
        name: "Maria Hamutenya",
      },
    }),
  ]);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.topupRequest.createMany({
    data: [
      {
        userId: users[0].id,
        betAccountId: users[0].betAccountId,
        expectedAmount: 100.0,
        refCode: "BET4821",
        status: TopupStatus.AWAITING,
        expiresAt,
      },
      {
        userId: users[1].id,
        betAccountId: users[1].betAccountId,
        expectedAmount: 250.0,
        refCode: "BET4822",
        status: TopupStatus.AWAITING,
        expiresAt,
      },
      {
        userId: users[2].id,
        betAccountId: users[2].betAccountId,
        expectedAmount: 50.0,
        refCode: "BET4823",
        status: TopupStatus.AWAITING,
        expiresAt,
      },
    ],
  });

  console.log("Seed complete.");
  console.log("Staff: admin@example.com / admin123 (ADMIN)");
  console.log("Staff: operator@example.com / operator123 (OPERATOR)");
  console.log("Device API keys (dev only):");
  for (const d of deviceKeys) {
    console.log(`  ${d.name}: ${d.apiKey}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
