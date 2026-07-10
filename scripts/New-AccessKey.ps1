<#
.SYNOPSIS
    Manage Web Inventory access keys (inv.AccessKey).

.DESCRIPTION
    Access keys replace the old Entra/SWA login: any active key grants full access
    to the app. Keys are generated here on your machine; only the SHA-256 hash is
    written to the database, so the raw key is shown exactly once — copy it then.

    Auth to SQL uses Entra (ActiveDirectoryDefault), matching the rest of the repo,
    so run `az login` first. Requires the `sqlcmd` (go-sqlcmd) CLI.

.PARAMETER Name
    A label for the new key (e.g. a person or device). Used when generating.

.PARAMETER List
    List existing keys (id, name, state, last used) — never prints hashes.

.PARAMETER Disable
    Disable (revoke) the key with the given Id (GUID, copy from -List).

.PARAMETER Server
    Azure SQL server FQDN. Defaults to the shared webportfolio server.

.PARAMETER Database
    Database name. Defaults to webportfolio.

.EXAMPLE
    ./New-AccessKey.ps1 -Name "jim-iphone"
    ./New-AccessKey.ps1 -List
    ./New-AccessKey.ps1 -Disable 8f3c...guid
#>
[CmdletBinding(DefaultParameterSetName = 'Generate')]
param(
    [Parameter(ParameterSetName = 'Generate', Position = 0)]
    [string] $Name,

    [Parameter(ParameterSetName = 'List')]
    [switch] $List,

    [Parameter(ParameterSetName = 'Disable')]
    [string] $Disable,

    [string] $Server = 'sqlgkhw25ijhyzzy.database.windows.net',
    [string] $Database = 'webportfolio'
)

$ErrorActionPreference = 'Stop'

function Invoke-Sql {
    param([Parameter(Mandatory)] [string] $Query)
    # -C trust server cert, --authentication-method ActiveDirectoryDefault (Entra).
    $out = sqlcmd -S $Server -d $Database -C `
        --authentication-method=ActiveDirectoryDefault `
        -h -1 -W -s '|' -Q $Query 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "sqlcmd failed:`n$out"
    }
    return $out
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)] [string] $Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))
        return -join ($bytes | ForEach-Object { $_.ToString('x2') })
    } finally {
        $sha.Dispose()
    }
}

switch ($PSCmdlet.ParameterSetName) {
    'List' {
        $rows = Invoke-Sql @'
SET NOCOUNT ON;
SELECT CONVERT(varchar(36), Id), Name,
       CASE WHEN Disabled = 1 THEN 'disabled' ELSE 'active' END,
       ISNULL(CONVERT(varchar(19), LastUsedAt, 126), 'never')
FROM inv.AccessKey
ORDER BY CreatedAt;
'@
        $rows = @($rows | Where-Object { $_ -and $_.Trim() -ne '' })
        if ($rows.Count -eq 0) { Write-Host 'No keys.'; break }
        "{0,-36}  {1,-20}  {2,-9}  {3}" -f 'Id', 'Name', 'State', 'LastUsed' | Write-Host
        foreach ($r in $rows) {
            $p = $r -split '\|'
            "{0,-36}  {1,-20}  {2,-9}  {3}" -f $p[0].Trim(), $p[1].Trim(), $p[2].Trim(), $p[3].Trim() | Write-Host
        }
        break
    }

    'Disable' {
        $id = $Disable.Replace("'", "''")
        Invoke-Sql "UPDATE inv.AccessKey SET Disabled = 1 WHERE Id = '$id';" | Out-Null
        Write-Host "Key '$Disable' disabled (if it existed)."
        break
    }

    'Generate' {
        if ([string]::IsNullOrWhiteSpace($Name)) {
            throw "Provide -Name for the new key, or use -List / -Disable."
        }
        # 32 random bytes -> url-safe base64 (~43 chars), matching fittrack's entropy.
        $raw = [byte[]]::new(32)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($raw)
        $key = [Convert]::ToBase64String($raw).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $hash = Get-Sha256Hex -Text $key
        $safeName = $Name.Replace("'", "''")

        Invoke-Sql "INSERT INTO inv.AccessKey (Name, KeyHash) VALUES ('$safeName', '$hash');" | Out-Null

        Write-Host ''
        Write-Host '  Access key created. Copy it now — it will NOT be shown again:' -ForegroundColor Yellow
        Write-Host ''
        Write-Host "    $key" -ForegroundColor Green
        Write-Host ''
        Write-Host "  name=$Name"
        Write-Host ''
        break
    }
}
