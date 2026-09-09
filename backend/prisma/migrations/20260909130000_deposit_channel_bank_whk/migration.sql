-- AlterEnum: add BANK_WHK to WalletProvider
ALTER TABLE `DepositEvent` MODIFY `provider` ENUM('PAYPULSE', 'EASYWALLET', 'PAY2CELL', 'EWALLET', 'BANK_WHK') NOT NULL;
ALTER TABLE `WalletNumber` MODIFY `provider` ENUM('PAYPULSE', 'EASYWALLET', 'PAY2CELL', 'EWALLET', 'BANK_WHK') NOT NULL;

-- CreateEnum DepositChannel via column default
ALTER TABLE `DepositEvent`
  ADD COLUMN `channel` ENUM('WALLET', 'BANK') NOT NULL DEFAULT 'WALLET';

-- CreateIndex
CREATE INDEX `DepositEvent_channel_idx` ON `DepositEvent`(`channel`);
CREATE INDEX `DepositEvent_channel_receivedAt_idx` ON `DepositEvent`(`channel`, `receivedAt`);
