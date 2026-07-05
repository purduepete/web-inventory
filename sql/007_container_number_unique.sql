/* =====================================================================
   Web Inventory — enforce uniqueness of container numbers.

   CreateContainerAsync allocates the smallest unused number via a gap
   scan. That scan now runs inside a SERIALIZABLE transaction, but this
   UNIQUE constraint is the hard backstop that guarantees two concurrent
   creates can never persist the same Number (the loser retries).

   Idempotent: safe to re-run. Fails loudly if legacy duplicates exist
   so they can be resolved before the constraint is added.

   NOTE: this migration alters the database. Per the project's DB-change
   rule it requires a second-opinion review (Gemini) before it is run.
   ===================================================================== */

IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_inv_Container_Number')
    AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_inv_Container_Number' AND object_id = OBJECT_ID('inv.Container'))
BEGIN
    IF EXISTS (SELECT Number FROM inv.Container GROUP BY Number HAVING COUNT(*) > 1)
        THROW 50000, 'Duplicate inv.Container.Number values exist; resolve them before adding UQ_inv_Container_Number.', 1;

    ALTER TABLE inv.Container ADD CONSTRAINT UQ_inv_Container_Number UNIQUE (Number);
END
GO
