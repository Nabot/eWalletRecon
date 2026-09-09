-- AlterTable
ALTER TABLE `DepositEvent`
  ADD COLUMN `creditProvider` VARCHAR(191) NULL,
  ADD COLUMN `pstbetOurReference` VARCHAR(191) NULL,
  ADD COLUMN `pstbetTheirReference` VARCHAR(191) NULL,
  ADD COLUMN `creditError` TEXT NULL;

-- CreateIndex
CREATE INDEX `DepositEvent_pstbetOurReference_idx` ON `DepositEvent`(`pstbetOurReference`);
