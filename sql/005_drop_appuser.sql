/* =====================================================================
   Web Inventory — drop the obsolete inv.AppUser table.
   In-app member management was removed (it required SWA custom auth /
   rolesSource, which broke the built-in aad login). Household access is
   now handled entirely by SWA invites granting the `member` role. The
   AppUser table is no longer referenced by any code. Idempotent.
   ===================================================================== */

IF OBJECT_ID('inv.AppUser', 'U') IS NOT NULL
    DROP TABLE inv.AppUser;
GO
