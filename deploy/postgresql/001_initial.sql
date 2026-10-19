-- WebInventory PostgreSQL schema (database web_inventory, schema public).
-- Ported from sql/001..010 (Azure SQL schema inv). Identifiers are unquoted, so
-- PostgreSQL folds them to lowercase (inv.ClientMutationId -> public.container.clientmutationid).
-- Case-insensitive behavior from the SQL Server collation is kept with lower(name)
-- unique indexes; the repository compares and sorts with lower() / ILIKE.
-- Times are UTC timestamptz. Requires PostgreSQL 13+ (gen_random_uuid).

BEGIN;

CREATE TABLE IF NOT EXISTS public.owner
(
    id   uuid         NOT NULL CONSTRAINT pk_owner PRIMARY KEY,
    name varchar(200) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_name ON public.owner (lower(name));

CREATE TABLE IF NOT EXISTS public.location
(
    id   uuid         NOT NULL CONSTRAINT pk_location PRIMARY KEY,
    name varchar(200) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_location_name ON public.location (lower(name));

CREATE TABLE IF NOT EXISTS public.category
(
    id   uuid         NOT NULL CONSTRAINT pk_category PRIMARY KEY,
    name varchar(200) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_category_name ON public.category (lower(name));

CREATE TABLE IF NOT EXISTS public.container
(
    id               uuid         NOT NULL CONSTRAINT pk_container PRIMARY KEY,
    number           integer      NOT NULL CONSTRAINT uq_container_number UNIQUE,
    name             varchar(200) NOT NULL,
    notes            text         NULL,
    qrtoken          uuid         NOT NULL CONSTRAINT uq_container_qrtoken UNIQUE,
    createdat        timestamptz  NOT NULL DEFAULT now(),
    updatedat        timestamptz  NOT NULL DEFAULT now(),
    locationid       uuid         NULL CONSTRAINT fk_container_location REFERENCES public.location (id),
    ownerid          uuid         NULL CONSTRAINT fk_container_owner REFERENCES public.owner (id),
    clientmutationid uuid         NULL
);
CREATE INDEX IF NOT EXISTS ix_container_locationid ON public.container (locationid);
CREATE INDEX IF NOT EXISTS ix_container_ownerid ON public.container (ownerid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_container_clientmutationid
    ON public.container (clientmutationid) WHERE clientmutationid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.item
(
    id               uuid         NOT NULL CONSTRAINT pk_item PRIMARY KEY,
    containerid      uuid         NOT NULL CONSTRAINT fk_item_container REFERENCES public.container (id),
    name             varchar(300) NOT NULL,
    description      text         NULL,
    quantity         integer      NOT NULL DEFAULT 1,
    source           varchar(10)  NOT NULL DEFAULT 'manual',
    createdat        timestamptz  NOT NULL DEFAULT now(),
    updatedat        timestamptz  NOT NULL DEFAULT now(),
    categoryid       uuid         NULL CONSTRAINT fk_item_category REFERENCES public.category (id),
    clientmutationid uuid         NULL
);
CREATE INDEX IF NOT EXISTS ix_item_containerid ON public.item (containerid);
CREATE INDEX IF NOT EXISTS ix_item_categoryid ON public.item (categoryid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_clientmutationid
    ON public.item (clientmutationid) WHERE clientmutationid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.photo
(
    id               uuid          NOT NULL CONSTRAINT pk_photo PRIMARY KEY,
    containerid      uuid          NOT NULL CONSTRAINT fk_photo_container REFERENCES public.container (id),
    bloburl          varchar(1000) NOT NULL,
    thumburl         varchar(1000) NOT NULL,
    takenat          timestamptz   NOT NULL DEFAULT now(),
    processedat      timestamptz   NULL,
    clientmutationid uuid          NULL
);
CREATE INDEX IF NOT EXISTS ix_photo_containerid ON public.photo (containerid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_clientmutationid
    ON public.photo (clientmutationid) WHERE clientmutationid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tag
(
    id   uuid         NOT NULL CONSTRAINT pk_tag PRIMARY KEY,
    name varchar(100) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_name ON public.tag (lower(name));

CREATE TABLE IF NOT EXISTS public.itemtag
(
    itemid uuid NOT NULL CONSTRAINT fk_itemtag_item REFERENCES public.item (id),
    tagid  uuid NOT NULL CONSTRAINT fk_itemtag_tag REFERENCES public.tag (id),
    CONSTRAINT pk_itemtag PRIMARY KEY (itemid, tagid)
);
CREATE INDEX IF NOT EXISTS ix_itemtag_tagid ON public.itemtag (tagid);

-- Kept for data preservation; the app no longer reads it (Cloudflare Access + Tailscale).
CREATE TABLE IF NOT EXISTS public.accesskey
(
    id         uuid         NOT NULL DEFAULT gen_random_uuid() CONSTRAINT pk_accesskey PRIMARY KEY,
    name       varchar(100) NOT NULL,
    keyhash    char(64)     NOT NULL CONSTRAINT uq_accesskey_keyhash UNIQUE,
    disabled   boolean      NOT NULL DEFAULT false,
    createdat  timestamptz  NOT NULL DEFAULT now(),
    lastusedat timestamptz  NULL
);

COMMIT;
