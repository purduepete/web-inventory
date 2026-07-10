/* =====================================================================
   Web Inventory — key-based access.
   Replaces the Entra/SWA `member` gate with DB-backed access keys.
   Each key is a high-entropy random string; only its SHA-256 hash is
   stored here (the raw key is shown once at generation). Any active
   (not disabled) key grants full access. Revoke by setting Disabled = 1.
   Idempotent: safe to re-run.
   ===================================================================== */

IF OBJECT_ID('inv.AccessKey', 'U') IS NULL
CREATE TABLE inv.AccessKey
(
    Id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_AccessKey PRIMARY KEY
                                          CONSTRAINT DF_inv_AccessKey_Id DEFAULT NEWID(),
    Name       NVARCHAR(100)    NOT NULL,
    /* SHA-256 hex digest of the raw key (64 lowercase hex chars). */
    KeyHash    CHAR(64)         NOT NULL CONSTRAINT UQ_inv_AccessKey_KeyHash UNIQUE,
    Disabled   BIT              NOT NULL CONSTRAINT DF_inv_AccessKey_Disabled DEFAULT 0,
    CreatedAt  DATETIME2        NOT NULL CONSTRAINT DF_inv_AccessKey_CreatedAt DEFAULT SYSUTCDATETIME(),
    LastUsedAt DATETIME2        NULL
);
GO
