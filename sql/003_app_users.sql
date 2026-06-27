/* =====================================================================
   Web Inventory — application users & roles.
   Backs the Static Web Apps custom roles function (/api/GetRoles) so an
   in-app admin can pre-authorize household members by email. Idempotent.
   ===================================================================== */

IF OBJECT_ID('inv.AppUser', 'U') IS NULL
CREATE TABLE inv.AppUser
(
    Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_AppUser PRIMARY KEY,
    Email       NVARCHAR(256)    NOT NULL CONSTRAINT UQ_inv_AppUser_Email UNIQUE,
    Role        VARCHAR(20)      NOT NULL CONSTRAINT DF_inv_AppUser_Role DEFAULT 'member',
    DisplayName NVARCHAR(256)    NULL,
    InvitedBy   NVARCHAR(256)    NULL,
    CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_inv_AppUser_CreatedAt DEFAULT SYSUTCDATETIME(),
    LastLoginAt DATETIME2        NULL,
    CONSTRAINT CK_inv_AppUser_Role CHECK (Role IN ('member', 'admin'))
);
GO

/* Seed the first admin. Emails are stored lower-cased so lookups can match
   the case-insensitive identity provided by Entra at login. */
MERGE inv.AppUser AS target
USING (SELECT 'jimb@jimlertech.com' AS Email) AS source
ON LOWER(target.Email) = source.Email
WHEN MATCHED THEN
    UPDATE SET Role = 'admin'
WHEN NOT MATCHED THEN
    INSERT (Id, Email, Role, InvitedBy)
    VALUES (NEWID(), source.Email, 'admin', 'seed');
GO
