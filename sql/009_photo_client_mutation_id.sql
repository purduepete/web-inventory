/* =====================================================================
   Web Inventory — client mutation id for idempotent photo uploads (R3 / #10).

   Photo uploads (POST containers/{id}/photos) were the last non-idempotent
   sync operation: a photo captured offline (or an online upload whose response
   was lost) is retried by the sync queue and a DUPLICATE photo row + blob is
   created. The client now stamps each photo upload with a stable
   ClientMutationId (crypto.randomUUID), sent via the X-Client-Mutation-Id
   header. Storing it here — behind a FILTERED UNIQUE index (NULLs allowed for
   pre-existing / server-side rows) — lets the API detect a replay and return
   the original photo instead of storing a second copy.

   Scope: inv.Photo only. Mirrors migration 008 (Container/Item idempotency).

   Idempotent: safe to re-run (guarded column add + index existence check).

   NOTE: this migration alters the database. Per the project's DB-change rule
   it requires a second-opinion review (Gemini) before it is run.
   ===================================================================== */

IF COL_LENGTH('inv.Photo', 'ClientMutationId') IS NULL
    ALTER TABLE inv.Photo ADD ClientMutationId UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'UX_inv_Photo_ClientMutationId'
                 AND object_id = OBJECT_ID('inv.Photo'))
    CREATE UNIQUE INDEX UX_inv_Photo_ClientMutationId
        ON inv.Photo (ClientMutationId)
        WHERE ClientMutationId IS NOT NULL;
GO
