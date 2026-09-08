-- Append-only audit trail: filter indexes + deny UPDATE/DELETE
CREATE INDEX `AuditLog_action_createdAt_idx` ON `AuditLog`(`action`, `createdAt`);
CREATE INDEX `AuditLog_actorType_createdAt_idx` ON `AuditLog`(`actorType`, `createdAt`);

DROP TRIGGER IF EXISTS `auditlog_no_update`;
DROP TRIGGER IF EXISTS `auditlog_no_delete`;

CREATE TRIGGER `auditlog_no_update`
BEFORE UPDATE ON `AuditLog`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only';

CREATE TRIGGER `auditlog_no_delete`
BEFORE DELETE ON `AuditLog`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only';
