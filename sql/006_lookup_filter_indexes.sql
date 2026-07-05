/* =====================================================================
   Web Inventory — nonclustered indexes for the lookup filter columns
   added in 003_owners_locations_categories.sql.

   SearchAsync / facet queries filter by Container.LocationId,
   Container.OwnerId and Item.CategoryId, but those FK columns had no
   supporting indexes, so filtered searches degrade to scans as data
   grows. These indexes cover those predicates.

   Idempotent: safe to re-run.

   NOTE: this migration alters the database. Per the project's DB-change
   rule it requires a second-opinion review (Gemini) before it is run.
   ===================================================================== */

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inv_Container_LocationId' AND object_id = OBJECT_ID('inv.Container'))
    CREATE NONCLUSTERED INDEX IX_inv_Container_LocationId ON inv.Container(LocationId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inv_Container_OwnerId' AND object_id = OBJECT_ID('inv.Container'))
    CREATE NONCLUSTERED INDEX IX_inv_Container_OwnerId ON inv.Container(OwnerId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inv_Item_CategoryId' AND object_id = OBJECT_ID('inv.Item'))
    CREATE NONCLUSTERED INDEX IX_inv_Item_CategoryId ON inv.Item(CategoryId);
GO
