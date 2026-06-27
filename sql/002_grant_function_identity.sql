-- Grant the Function App's managed identity access to the inv schema.
-- Run as an Entra admin on the server.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'webinv-api-xkedjb')
BEGIN
    CREATE USER [webinv-api-xkedjb] FROM EXTERNAL PROVIDER;
END
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::inv TO [webinv-api-xkedjb];
GRANT EXECUTE ON SCHEMA::inv TO [webinv-api-xkedjb];
-- Container number sequence needs UPDATE to call NEXT VALUE FOR.
GRANT UPDATE ON OBJECT::inv.ContainerNumberSeq TO [webinv-api-xkedjb];
