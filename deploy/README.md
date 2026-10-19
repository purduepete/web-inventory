# WebInventory deployment

The PWA and API run together on jimbrownhome1:

| Component | Location |
|---|---|
| Public site | https://web-inventory.jimlertech.com/ |
| Private fallback | https://jimbrownhome1.tail8ad282.ts.net:8795/ |
| Origin | `http://127.0.0.1:18795` |
| Database | `web_inventory`, tables in `public` |
| Images | `D:\SolutionDeploy\apps\web-inventory\images` |
| App | `C:\ProgramData\SolutionDeploy\apps\web-inventory` |
| Task | `\JimlerTech\SolutionDeploy-web-inventory`, LOCAL SERVICE |
| Migration archive | `C:\ProgramData\SolutionDeploy\archives\web-inventory-migration-20261018` |

Cloudflare Access checks approved owner emails through Google or Microsoft.
Tailscale controls private access. The origin binds loopback only; an application
key is no longer required. Source access-key hashes are retained in PostgreSQL
but aren't used by the deployed API.

## Build

Use Node and the .NET 10 SDK:

```powershell
Push-Location .\client
npm ci
npm run build
Pop-Location
dotnet publish .\api -c Release -r win-x64 --self-contained true -o .\publish
Copy-Item .\client\dist .\publish\wwwroot -Recurse
Copy-Item .\deploy .\publish\deploy -Recurse
```

The production client uses same-origin `/api` and platform authentication through
`client\.env.production`. The self-contained Windows runtime needs no .NET install
on the host. Start it through `Start-InventoryService.ps1`, which loads protected
settings then runs the executable with output in `shared\logs\web-inventory.log`.
This native .NET boot task is separate from the framework's Node/Python watchdog.

`shared\secrets\settings.json` requires `PostgresConnectionString`,
`ImageDirectory`, `OpenAiEndpoint`, `OpenAiDeployment`, and `OpenAiKey`.
Only SYSTEM, administrators and LOCAL SERVICE may read it. Keep secrets out of
source control. LOCAL SERVICE needs read/traverse access to the app and release,
write access to logs, and modify access to the image directory. The boot task has
no execution limit and restarts on failure.

Image URLs are same-origin `/images/<container-guid>/<photo-guid>.jpg` and
`_thumb.jpg`. The file service accepts only this GUID-based shape. No Azure SAS
URLs or publicly accessible image origin is needed.

## Migration and verification

Stop `webinv-api-xkedjb` before the final Azure SQL/Blob snapshot. Preserve all
9 tables and IDs. Independently review schema/import scripts before execution.
Apply `postgresql\001_initial.sql` to the dedicated empty database, then run
`Import-InventorySnapshot.ps1 -SnapshotDirectory <path> -ApiPath <published-api>
-Commit` with `WEBINVENTORY_POSTGRES_ADMIN_CONNECTION` set securely.

The importer rejects populated tables and unexpected columns/URLs. It compares
every imported column before commit, with UTC timestamps reduced to PostgreSQL's
microsecond precision. Only photo URL prefixes change. Without `-Commit`, the
import and comparison run inside a rolled-back transaction.

Copy all source image files to D: and compare SHA-256 hashes. Keep the source
Azure SQL tables and Blob images. Leave the old Function stopped.

Validate public Access redirects and both sign-in choices, private `/healthz`,
all containers/items/lookups/search, and every full/thumbnail image. The isolated
`Test-MigratedInventory.ps1` checks writes, duplicate mutation IDs, image upload,
rotation and moves. It deletes only its own test records; obtain independent
review before running its deletion cleanup against a live database.

The existing ImageSharp 2.1.11 dependency still has NuGet security advisories.
It was retained during migration; changing the decoder or its licensing is a
separate dependency maintenance task.

Reinstall the PWA from the new hostname. Offline browser data from the old Azure
origin doesn't transfer. Existing container IDs and QR tokens remain valid in
the new app, but printed labels containing the old hostname need reprinting.
