-- CreateTable
CREATE TABLE `WalletNumber` (
    `id` VARCHAR(191) NOT NULL,
    `msisdn` VARCHAR(191) NOT NULL,
    `provider` ENUM('PAYPULSE', 'EASYWALLET', 'PAY2CELL', 'EWALLET') NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `deviceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WalletNumber_msisdn_key`(`msisdn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CaptureDevice` (
    `id` VARCHAR(191) NOT NULL,
    `apiKeyHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `walletNumberId` VARCHAR(191) NOT NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CaptureDevice_walletNumberId_key`(`walletNumberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DepositEvent` (
    `id` VARCHAR(191) NOT NULL,
    `walletNumberId` VARCHAR(191) NOT NULL,
    `provider` ENUM('PAYPULSE', 'EASYWALLET', 'PAY2CELL', 'EWALLET') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NAD',
    `senderMsisdn` VARCHAR(191) NULL,
    `senderName` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `rawMessage` TEXT NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `matchStatus` ENUM('PENDING', 'MATCHED', 'UNMATCHED', 'MANUAL') NOT NULL DEFAULT 'PENDING',
    `matchedTopupRequestId` VARCHAR(191) NULL,
    `source` ENUM('SMS', 'WEBHOOK', 'MANUAL') NOT NULL DEFAULT 'SMS',
    `externalId` VARCHAR(191) NULL,
    `captureIdempotencyKey` VARCHAR(191) NULL,
    `creditBetAccountId` VARCHAR(191) NULL,
    `creditNote` TEXT NULL,
    `creditedAt` DATETIME(3) NULL,
    `creditedByStaffId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DepositEvent_captureIdempotencyKey_key`(`captureIdempotencyKey`),
    INDEX `DepositEvent_matchStatus_idx`(`matchStatus`),
    INDEX `DepositEvent_receivedAt_idx`(`receivedAt`),
    INDEX `DepositEvent_walletNumberId_receivedAt_idx`(`walletNumberId`, `receivedAt`),
    INDEX `DepositEvent_creditBetAccountId_idx`(`creditBetAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopupRequest` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `betAccountId` VARCHAR(191) NOT NULL,
    `expectedAmount` DECIMAL(14, 2) NULL,
    `refCode` VARCHAR(191) NOT NULL,
    `status` ENUM('AWAITING', 'FULFILLED', 'EXPIRED') NOT NULL DEFAULT 'AWAITING',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TopupRequest_refCode_key`(`refCode`),
    INDEX `TopupRequest_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `TopupRequest_status_expectedAmount_idx`(`status`, `expectedAmount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `betAccountId` VARCHAR(191) NOT NULL,
    `registeredMsisdn` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_betAccountId_key`(`betAccountId`),
    INDEX `User_registeredMsisdn_idx`(`registeredMsisdn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreditLedger` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `depositEventId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CreditLedger_depositEventId_key`(`depositEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorType` ENUM('STAFF', 'DEVICE', 'SYSTEM') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'OPERATOR') NOT NULL DEFAULT 'OPERATOR',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StaffUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CaptureDevice` ADD CONSTRAINT `CaptureDevice_walletNumberId_fkey` FOREIGN KEY (`walletNumberId`) REFERENCES `WalletNumber`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepositEvent` ADD CONSTRAINT `DepositEvent_walletNumberId_fkey` FOREIGN KEY (`walletNumberId`) REFERENCES `WalletNumber`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepositEvent` ADD CONSTRAINT `DepositEvent_matchedTopupRequestId_fkey` FOREIGN KEY (`matchedTopupRequestId`) REFERENCES `TopupRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopupRequest` ADD CONSTRAINT `TopupRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditLedger` ADD CONSTRAINT `CreditLedger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CreditLedger` ADD CONSTRAINT `CreditLedger_depositEventId_fkey` FOREIGN KEY (`depositEventId`) REFERENCES `DepositEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

