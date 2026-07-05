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

Auth uses Static Web Apps' built-in Microsoft Entra login, and every route requires the
`member` role. To give someone access, add them as a guest (external) user in the Entra
tenant, then grant them the `member` role via the SWA invitation flow:

```powershell
az staticwebapp users invite --name webinv-web --resource-group webinv-rg `
  --authentication-provider aad --user-details "person@example.com" `
  --domain "polite-mushroom-086a4b20f.7.azurestaticapps.net" `
  --roles member --invitation-expiration-in-hours 168 --query invitationUrl -o tsv
```

Share the returned single-use link; the person opens it while signed in with that account
and is granted the `member` role.

Google login can be added later on the SWA Standard tier via a custom OIDC provider.

### Backend API access protection (do not remove)

The API is a **bring-your-own (linked) Azure Functions backend**, so it has its own public
URL (`https://webinv-api-xkedjb.azurewebsites.net`). It is *not* left open: linking the
Function App to the Static Web App automatically created an **App Service Authentication
("Easy Auth") identity provider named _Azure Static Web Apps (Linked)_** on the Function
App, with `requireAuthentication = true`. That platform gate — not application code — is
what stops direct access:

- A direct call to the Function URL returns **401** even with a forged `x-ms-client-principal`
  header (verified). Easy Auth runs before the worker, so the header can't be spoofed.
- Functions therefore stay at `AuthorizationLevel.Anonymous` **on purpose**. Do **not**
  switch them to `Function`/key auth — SWA does **not** forward function keys to a
  bring-your-own backend, so that would break the app. And do **not** add
  `x-ms-client-principal`-trusting middleware — it would be spoofable and give false security.
- Network-isolated (VNet/private-endpoint) backends are **not supported** for SWA linked
  backends, so isolation is not an option.

**Runbook — if the API starts returning 401 through the site, or you unlink/relink the
backend:** re-linking recreates the identity provider; unlinking deliberately leaves it in
place. If it was deleted, the Function App would accept anonymous direct traffic. Restore it
by re-linking the backend (SWA portal → APIs → Link), or re-add the *Azure Static Web Apps
(Linked)* identity provider under the Function App's **Authentication** blade with
"Require authentication" on. The Bicep intentionally does **not** declare these auth
settings — a bad `authsettingsV2` deploy could lock the app out of its own API, and there is
no non-prod environment to test against.

## Cost guardrails

- Photos are downscaled client-side (max 1024px) before upload + AI.
- Vision calls use `gpt-5-mini` at `low` image detail.
- Function App runs on Consumption; Static Web App on Standard (linked backends require it).
