-- CreateEnum
CREATE TYPE "WalletProvider" AS ENUM ('PAYPULSE', 'EASYWALLET', 'PAY2CELL', 'EWALLET');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED', 'MANUAL');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('AWAITING', 'FULFILLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'DEVICE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DepositSource" AS ENUM ('SMS', 'WEBHOOK', 'MANUAL');

-- CreateTable
CREATE TABLE "WalletNumber" (
    "id" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "provider" "WalletProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureDevice" (
    "id" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "walletNumberId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositEvent" (
    "id" TEXT NOT NULL,
    "walletNumberId" TEXT NOT NULL,
    "provider" "WalletProvider" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NAD',
    "senderMsisdn" TEXT,
    "reference" TEXT,
    "rawMessage" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "matchedTopupRequestId" TEXT,
    "source" "DepositSource" NOT NULL DEFAULT 'SMS',
    "externalId" TEXT,
    "captureIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopupRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "betAccountId" TEXT NOT NULL,
    "expectedAmount" DECIMAL(14,2),
    "refCode" TEXT NOT NULL,
    "status" "TopupStatus" NOT NULL DEFAULT 'AWAITING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "betAccountId" TEXT NOT NULL,
    "registeredMsisdn" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "depositEventId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'OPERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletNumber_msisdn_key" ON "WalletNumber"("msisdn");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureDevice_walletNumberId_key" ON "CaptureDevice"("walletNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEvent_captureIdempotencyKey_key" ON "DepositEvent"("captureIdempotencyKey");

-- CreateIndex
CREATE INDEX "DepositEvent_matchStatus_idx" ON "DepositEvent"("matchStatus");

-- CreateIndex
CREATE INDEX "DepositEvent_receivedAt_idx" ON "DepositEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "DepositEvent_walletNumberId_receivedAt_idx" ON "DepositEvent"("walletNumberId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TopupRequest_refCode_key" ON "TopupRequest"("refCode");

-- CreateIndex
CREATE INDEX "TopupRequest_status_expiresAt_idx" ON "TopupRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "TopupRequest_status_expectedAmount_idx" ON "TopupRequest"("status", "expectedAmount");

-- CreateIndex
CREATE UNIQUE INDEX "User_betAccountId_key" ON "User"("betAccountId");

-- CreateIndex
CREATE INDEX "User_registeredMsisdn_idx" ON "User"("registeredMsisdn");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_depositEventId_key" ON "CreditLedger"("depositEventId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- AddForeignKey
ALTER TABLE "CaptureDevice" ADD CONSTRAINT "CaptureDevice_walletNumberId_fkey" FOREIGN KEY ("walletNumberId") REFERENCES "WalletNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEvent" ADD CONSTRAINT "DepositEvent_walletNumberId_fkey" FOREIGN KEY ("walletNumberId") REFERENCES "WalletNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEvent" ADD CONSTRAINT "DepositEvent_matchedTopupRequestId_fkey" FOREIGN KEY ("matchedTopupRequestId") REFERENCES "TopupRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopupRequest" ADD CONSTRAINT "TopupRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_depositEventId_fkey" FOREIGN KEY ("depositEventId") REFERENCES "DepositEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

