-- AlterTable
ALTER TABLE "DepositEvent" ADD COLUMN "creditBetAccountId" TEXT;
ALTER TABLE "DepositEvent" ADD COLUMN "creditNote" TEXT;
ALTER TABLE "DepositEvent" ADD COLUMN "creditedAt" TIMESTAMP(3);
ALTER TABLE "DepositEvent" ADD COLUMN "creditedByStaffId" TEXT;

-- CreateIndex
CREATE INDEX "DepositEvent_creditBetAccountId_idx" ON "DepositEvent"("creditBetAccountId");
