# Web Inventory

An installable PWA (iPhone-first) to inventory the contents of physical containers.
Photograph a container's contents → Azure OpenAI (gpt-5-mini vision) suggests items →
you confirm/edit → items are saved and fully editable over time. Containers get printable
QR labels; scanning one opens the container. Find items via search, tags, browse, or a
photo grid. Works offline and syncs when reconnected.

## Stack

| Layer   | Tech                                                                                      |
| ------- | ----------------------------------------------------------------------------------------- |
| Client  | React + TypeScript + Vite, PWA (`vite-plugin-pwa`), Dexie (offline), html5-qrcode, qrcode |
| API     | C# .NET 8 isolated Azure Functions, Dapper                                                |
| Hosting | Azure Static Web Apps (Standard) + linked Function App (Consumption)                      |
| Auth    | Static Web Apps built-in auth (Microsoft Entra), `member` role gating                     |
| Data    | Existing Azure SQL `webportfolio` DB, new `inv` schema                                    |
| Images  | New Azure Storage account (Blob), managed identity                                        |
| AI      | New Azure OpenAI resource, `gpt-5-mini` deployment                                        |

## Layout

```
client/   React PWA
api/      .NET isolated Functions API
infra/    Bicep (subscription-scoped: new RG + resources)
sql/      Schema scripts for the inv schema
.github/  CI/CD workflows
```

## Local development

```powershell
# API (terminal 1)
cd api
cp local.settings.json.example local.settings.json   # fill in real values
func start                                            # http://localhost:7071

# Client (terminal 2)
cd client
npm install
npm run dev                                           # http://localhost:5173 (proxies /api)
```

Local auth/SQL/Blob/OpenAI use `DefaultAzureCredential` — run `az login` so your developer
identity is used. Grant your account access to the SQL DB and resources (see below).

## Provisioning (one-time)

```powershell
az login
az deployment sub create `
  --location eastus `
  --template-file infra/main.bicep `
  --parameters namePrefix=webinv
```

Outputs include the Static Web App name, Function App name, storage account, and OpenAI
endpoint. The Bicep also grants the Function App's managed identity **Storage Blob Data
Contributor** and **Cognitive Services OpenAI User**.

### Apply the database schema

```powershell
sqlcmd -S "sqlgkhw25ijhyzzy.database.windows.net" -d "webportfolio" `
  --authentication-method=ActiveDirectoryDefault -i sql/001_schema.sql
```

### Grant the Function App access to SQL

Connect to the DB and create a contained user for the Function App's managed identity:

```sql
CREATE USER [<function-app-name>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<function-app-name>];
ALTER ROLE db_datawriter ADD MEMBER [<function-app-name>];
```

## CI/CD

Two workflows deploy on push to `main`:

- `azure-static-web-apps.yml` — builds and deploys `client/` to Static Web Apps.
  Secret: `AZURE_STATIC_WEB_APPS_API_TOKEN` (from the SWA resource).
- `deploy-api.yml` — publishes `api/` to the Function App.
  Secrets: `AZURE_FUNCTIONAPP_NAME`, `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`.

## Household access

Auth uses Microsoft Entra login. Routes require the `member` role. Invite each household
member from the Static Web App's **Role management** and assign them the `member` role.
Google login can be added later on the SWA Standard tier via a custom OIDC provider.

## Cost guardrails

- Photos are downscaled client-side (max 1024px) before upload + AI.
- Vision calls use `gpt-5-mini` at `low` image detail.
- Function App runs on Consumption; Static Web App on Standard (linked backends require it).
