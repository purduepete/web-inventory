/* =====================================================================
   Web Inventory — client mutation id for idempotent offline sync (B2).

   Offline creates (createContainer, addItem) are the only non-idempotent
   sync operations: if the client sends a create, the row commits, but the
   response is lost (dropped connection), the client retries and a duplicate
   is created. The client now stamps each create mutation with a stable
   ClientMutationId (crypto.randomUUID). Storing it here — behind a FILTERED
   UNIQUE index (NULLs allowed for pre-existing / server-side rows) — lets the
   repository detect a replay and return the original row instead of inserting
   a second one.

   Scope: inv.Container and inv.Item only. Photo idempotency uses a different
   (header-based) mechanism and is tracked as a separate follow-up.

   Idempotent: safe to re-run (guarded column adds + index existence checks).

   NOTE: this migration alters the database. Per the project's DB-change rule
   it requires a second-opinion review (Gemini) before it is run.
   ===================================================================== */

IF COL_LENGTH('inv.Container', 'ClientMutationId') IS NULL
    ALTER TABLE inv.Container ADD ClientMutationId UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('inv.Item', 'ClientMutationId') IS NULL
    ALTER TABLE inv.Item ADD ClientMutationId UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'UX_inv_Container_ClientMutationId'
                 AND object_id = OBJECT_ID('inv.Container'))
    CREATE UNIQUE INDEX UX_inv_Container_ClientMutationId
        ON inv.Container (ClientMutationId)
        WHERE ClientMutationId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'UX_inv_Item_ClientMutationId'
                 AND object_id = OBJECT_ID('inv.Item'))
    CREATE UNIQUE INDEX UX_inv_Item_ClientMutationId
        ON inv.Item (ClientMutationId)
        WHERE ClientMutationId IS NOT NULL;
GO
