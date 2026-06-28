/* =====================================================================
   Web Inventory — drop the legacy free-text Container.Location column.

   Background: migration 003 introduced inv.Location plus
   Container.LocationId (FK -> inv.Location) and migrated the old
   free-text values into the lookup list. The original
   Container.Location NVARCHAR column is now obsolete: the API reads
   location names through the join (l.Name AS Location) and writes only
   LocationId. Keeping the text column around lets it drift out of sync
   with the FK, so we remove it.

   Idempotent: safe to re-run. Re-runs 003's backfill first so no
   location value is lost before the column is dropped.
   ===================================================================== */

/* Safety net: make sure every non-empty legacy text value exists in the
   lookup list and is linked before we drop the column. */
IF COL_LENGTH('inv.Container', 'Location') IS NOT NULL
BEGIN
    INSERT INTO inv.Location (Id, Name)
    SELECT NEWID(), x.Name
    FROM (
        SELECT DISTINCT LTRIM(RTRIM(Location)) AS Name
        FROM inv.Container
        WHERE Location IS NOT NULL AND LTRIM(RTRIM(Location)) <> ''
    ) x
    WHERE NOT EXISTS (SELECT 1 FROM inv.Location l WHERE l.Name = x.Name);

    UPDATE c
    SET c.LocationId = l.Id
    FROM inv.Container c
    JOIN inv.Location l ON l.Name = LTRIM(RTRIM(c.Location))
    WHERE c.LocationId IS NULL
      AND c.Location IS NOT NULL
      AND LTRIM(RTRIM(c.Location)) <> '';
END
GO

/* Drop the now-redundant free-text column. */
IF COL_LENGTH('inv.Container', 'Location') IS NOT NULL
    ALTER TABLE inv.Container DROP COLUMN Location;
GO
