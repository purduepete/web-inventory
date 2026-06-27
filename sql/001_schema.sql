/* =====================================================================
   Web Inventory — schema for the shared "webportfolio" database.
   All objects live in the dedicated [inv] schema so they don't collide
   with existing tables. Safe to re-run (idempotent guards).
   ===================================================================== */

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'inv')
    EXEC('CREATE SCHEMA inv');
GO

/* Human-friendly, monotonically increasing container numbers. */
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'ContainerNumberSeq' AND SCHEMA_NAME(schema_id) = 'inv')
    CREATE SEQUENCE inv.ContainerNumberSeq AS INT START WITH 1 INCREMENT BY 1;
GO

IF OBJECT_ID('inv.Container', 'U') IS NULL
CREATE TABLE inv.Container
(
    Id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_Container PRIMARY KEY,
    Number    INT              NOT NULL,
    Name      NVARCHAR(200)    NOT NULL,
    Location  NVARCHAR(200)    NULL,
    Notes     NVARCHAR(MAX)    NULL,
    QrToken   UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_inv_Container_QrToken UNIQUE,
    CreatedAt DATETIME2        NOT NULL CONSTRAINT DF_inv_Container_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2        NOT NULL CONSTRAINT DF_inv_Container_UpdatedAt DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('inv.Item', 'U') IS NULL
CREATE TABLE inv.Item
(
    Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_Item PRIMARY KEY,
    ContainerId UNIQUEIDENTIFIER NOT NULL,
    Name        NVARCHAR(300)    NOT NULL,
    Description NVARCHAR(MAX)    NULL,
    Quantity    INT              NOT NULL CONSTRAINT DF_inv_Item_Quantity DEFAULT 1,
    Source      VARCHAR(10)      NOT NULL CONSTRAINT DF_inv_Item_Source DEFAULT 'manual',
    CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_inv_Item_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt   DATETIME2        NOT NULL CONSTRAINT DF_inv_Item_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_inv_Item_Container FOREIGN KEY (ContainerId) REFERENCES inv.Container(Id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inv_Item_ContainerId')
    CREATE INDEX IX_inv_Item_ContainerId ON inv.Item(ContainerId);
GO

IF OBJECT_ID('inv.Photo', 'U') IS NULL
CREATE TABLE inv.Photo
(
    Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_Photo PRIMARY KEY,
    ContainerId UNIQUEIDENTIFIER NOT NULL,
    BlobUrl     NVARCHAR(1000)   NOT NULL,
    ThumbUrl    NVARCHAR(1000)   NOT NULL,
    TakenAt     DATETIME2        NOT NULL CONSTRAINT DF_inv_Photo_TakenAt DEFAULT SYSUTCDATETIME(),
    ProcessedAt DATETIME2        NULL,
    CONSTRAINT FK_inv_Photo_Container FOREIGN KEY (ContainerId) REFERENCES inv.Container(Id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inv_Photo_ContainerId')
    CREATE INDEX IX_inv_Photo_ContainerId ON inv.Photo(ContainerId);
GO

IF OBJECT_ID('inv.Tag', 'U') IS NULL
CREATE TABLE inv.Tag
(
    Id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_inv_Tag PRIMARY KEY,
    Name NVARCHAR(100)    NOT NULL CONSTRAINT UQ_inv_Tag_Name UNIQUE
);
GO

IF OBJECT_ID('inv.ItemTag', 'U') IS NULL
CREATE TABLE inv.ItemTag
(
    ItemId UNIQUEIDENTIFIER NOT NULL,
    TagId  UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT PK_inv_ItemTag PRIMARY KEY (ItemId, TagId),
    CONSTRAINT FK_inv_ItemTag_Item FOREIGN KEY (ItemId) REFERENCES inv.Item(Id),
    CONSTRAINT FK_inv_ItemTag_Tag  FOREIGN KEY (TagId)  REFERENCES inv.Tag(Id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inv_ItemTag_TagId')
    CREATE INDEX IX_inv_ItemTag_TagId ON inv.ItemTag(TagId);
GO
