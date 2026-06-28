/* =====================================================================
   Web Inventory — managed lookup lists for Owners, Locations and
   Item Categories, plus the foreign keys that reference them.
   Idempotent: safe to re-run. Migrates the existing free-text
   Container.Location values into the new inv.Location list.
   ===================================================================== */

/* ---- Lookup tables ---- */
IF OBJECT_ID('inv.Owner', 'U') IS NULL
CREATE TABLE inv.Owner
(
    Id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_Owner PRIMARY KEY,
    Name NVARCHAR(200)    NOT NULL CONSTRAINT UQ_inv_Owner_Name UNIQUE
);
GO

IF OBJECT_ID('inv.Location', 'U') IS NULL
CREATE TABLE inv.Location
(
    Id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_Location PRIMARY KEY,
    Name NVARCHAR(200)    NOT NULL CONSTRAINT UQ_inv_Location_Name UNIQUE
);
GO

IF OBJECT_ID('inv.Category', 'U') IS NULL
CREATE TABLE inv.Category
(
    Id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_Category PRIMARY KEY,
    Name NVARCHAR(200)    NOT NULL CONSTRAINT UQ_inv_Category_Name UNIQUE
);
GO

/* ---- Container.LocationId / OwnerId ---- */
IF COL_LENGTH('inv.Container', 'LocationId') IS NULL
    ALTER TABLE inv.Container ADD LocationId UNIQUEIDENTIFIER NULL;
GO
IF COL_LENGTH('inv.Container', 'OwnerId') IS NULL
    ALTER TABLE inv.Container ADD OwnerId UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_inv_Container_Location')
    ALTER TABLE inv.Container
        ADD CONSTRAINT FK_inv_Container_Location FOREIGN KEY (LocationId) REFERENCES inv.Location(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_inv_Container_Owner')
    ALTER TABLE inv.Container
        ADD CONSTRAINT FK_inv_Container_Owner FOREIGN KEY (OwnerId) REFERENCES inv.Owner(Id);
GO

/* ---- Item.CategoryId ---- */
IF COL_LENGTH('inv.Item', 'CategoryId') IS NULL
    ALTER TABLE inv.Item ADD CategoryId UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_inv_Item_Category')
    ALTER TABLE inv.Item
        ADD CONSTRAINT FK_inv_Item_Category FOREIGN KEY (CategoryId) REFERENCES inv.Category(Id);
GO

/* ---- Migrate existing free-text Container.Location into the list ---- */
INSERT INTO inv.Location (Id, Name)
SELECT NEWID(), x.Name
FROM (
    SELECT DISTINCT LTRIM(RTRIM(Location)) AS Name
    FROM inv.Container
    WHERE Location IS NOT NULL AND LTRIM(RTRIM(Location)) <> ''
) x
WHERE NOT EXISTS (SELECT 1 FROM inv.Location l WHERE l.Name = x.Name);
GO

UPDATE c
SET c.LocationId = l.Id
FROM inv.Container c
JOIN inv.Location l ON l.Name = LTRIM(RTRIM(c.Location))
WHERE c.LocationId IS NULL AND c.Location IS NOT NULL AND LTRIM(RTRIM(c.Location)) <> '';
GO
