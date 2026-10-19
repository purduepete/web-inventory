#requires -Version 7.4
<#
.SYNOPSIS
Imports the WebInventory Azure SQL snapshot (Export-InventorySource.ps1 output) into
the empty PostgreSQL public schema created by deploy\postgresql\001_initial.sql.

All 9 tables load in one transaction. The script refuses non-empty targets, rewrites
photo URLs from Azure Blob to /images/..., reads every row back and compares it
column by column, and checks counts. Without -Commit it rolls back after verifying.
Output has counts only. No row values, URLs, hashes or connection details are printed.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SnapshotDirectory,
    # Folder of the published API that contains Npgsql.dll and its dependencies.
    [Parameter(Mandatory)][string]$ApiPath,
    [string]$ConnectionEnvironmentVariable = 'WEBINVENTORY_POSTGRES_ADMIN_CONNECTION',
    [switch]$Commit
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedCounts = [ordered]@{ AccessKey = 2; Category = 5; Container = 6; Item = 59; ItemTag = 0; Location = 8; Owner = 2; Photo = 6; Tag = 0 }

# Load order respects foreign keys. Types: g uuid, G nullable uuid, s text, S nullable text,
# i int, b bool, t timestamptz, T nullable timestamptz. Source names map to lowercase targets.
$tables = [ordered]@{
    Owner     = [ordered]@{ Id = 'g'; Name = 's' }
    Location  = [ordered]@{ Id = 'g'; Name = 's' }
    Category  = [ordered]@{ Id = 'g'; Name = 's' }
    Tag       = [ordered]@{ Id = 'g'; Name = 's' }
    Container = [ordered]@{ Id = 'g'; Number = 'i'; Name = 's'; Notes = 'S'; QrToken = 'g'; CreatedAt = 't'; UpdatedAt = 't'; LocationId = 'G'; OwnerId = 'G'; ClientMutationId = 'G' }
    Item      = [ordered]@{ Id = 'g'; ContainerId = 'g'; Name = 's'; Description = 'S'; Quantity = 'i'; Source = 's'; CreatedAt = 't'; UpdatedAt = 't'; CategoryId = 'G'; ClientMutationId = 'G' }
    Photo     = [ordered]@{ Id = 'g'; ContainerId = 'g'; BlobUrl = 's'; ThumbUrl = 's'; TakenAt = 't'; ProcessedAt = 'T'; ClientMutationId = 'G' }
    ItemTag   = [ordered]@{ ItemId = 'g'; TagId = 'g' }
    AccessKey = [ordered]@{ Id = 'g'; Name = 's'; KeyHash = 's'; Disabled = 'b'; CreatedAt = 't'; LastUsedAt = 'T' }
}
$sourceUrl = '^https://stwebinvxkedjbjx\.blob\.core\.windows\.net/photos/(?<c>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(?<p>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?<thumb>_thumb)?\.jpg$'

$npgsqlDll = Join-Path $ApiPath 'Npgsql.dll'
if (-not (Test-Path $npgsqlDll)) { throw "Npgsql.dll not found under ApiPath." }
# The API is a framework-dependent web app, so Npgsql dependencies such as
# Microsoft.Extensions.Logging.Abstractions live in the ASP.NET Core shared framework.
$runtimeVersion = [Environment]::Version
$aspNetShared = & dotnet --list-runtimes 2>$null | ForEach-Object {
    if ($_ -match '^Microsoft\.AspNetCore\.App (?<v>\d+\.\d+\.\d+) \[(?<dir>[^\]]+)\]$' -and [version]$Matches.v -ge [version]::new($runtimeVersion.Major, 0, 0) -and ([version]$Matches.v).Major -eq $runtimeVersion.Major) {
        [pscustomobject]@{ Version = [version]$Matches.v; FullName = Join-Path $Matches.dir $Matches.v }
    }
} | Sort-Object Version | Select-Object -Last 1
if (-not $aspNetShared) { throw "ASP.NET Core $($runtimeVersion.Major).x shared framework not found via 'dotnet --list-runtimes'." }$probe = @($ApiPath) + @($aspNetShared | ForEach-Object FullName)
[AppDomain]::CurrentDomain.add_AssemblyResolve([ResolveEventHandler]{
    param($sender, $e)
    $name = [Reflection.AssemblyName]::new($e.Name).Name
    foreach ($dir in $probe) {
        $candidate = Join-Path $dir "$name.dll"
        if (Test-Path $candidate) { return [Reflection.Assembly]::LoadFrom($candidate) }
    }
    $null
}.GetNewClosure())
Add-Type -Path $npgsqlDll

$connectionString = [Environment]::GetEnvironmentVariable($ConnectionEnvironmentVariable)
if ([string]::IsNullOrWhiteSpace($connectionString)) { throw "Environment variable $ConnectionEnvironmentVariable is not set." }

function ConvertTo-Value([string]$Type, [System.Text.Json.JsonElement]$Element, [string]$Where) {
    $kind = $Element.ValueKind
    if ($kind -eq 'Null') {
        if ($Type -cmatch '^[GST]$') { return [DBNull]::Value }
        throw "$Where is null but the column is NOT NULL."
    }
    switch -CaseSensitive ($Type) {
        { $_ -in 'g', 'G' } { return [Guid]::ParseExact($Element.GetString(), 'D') }
        { $_ -in 's', 'S' } { if ($kind -ne 'String') { throw "$Where is not a string." }; return $Element.GetString() }
        'i' { return $Element.GetInt32() }
        'b' { return $Element.GetBoolean() }
        { $_ -in 't', 'T' } {
            # The exporter writes SQL Server DATETIME2 (UTC) as yyyy-MM-ddTHH:mm:ss.fffffff with no offset.
            $d = [DateTime]::ParseExact($Element.GetString(), 'yyyy-MM-ddTHH:mm:ss.fffffff',
                [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
            return [DateTime]::SpecifyKind($d, [DateTimeKind]::Utc)
        }
    }
    throw "Unknown column type '$Type'."
}

function Get-DbType([string]$Type) {
    switch -CaseSensitive ($Type) {
        { $_ -in 'g', 'G' } { return [NpgsqlTypes.NpgsqlDbType]::Uuid }
        { $_ -in 's', 'S' } { return [NpgsqlTypes.NpgsqlDbType]::Text }
        'i' { return [NpgsqlTypes.NpgsqlDbType]::Integer }
        'b' { return [NpgsqlTypes.NpgsqlDbType]::Boolean }
        { $_ -in 't', 'T' } { return [NpgsqlTypes.NpgsqlDbType]::TimestampTz }
    }
}

# Canonical text for one value. Timestamps are truncated to microseconds, PostgreSQL's precision.
function Format-Canonical($Value) {
    if ($null -eq $Value -or $Value -is [DBNull]) { return '<null>' }
    if ($Value -is [Guid]) { return $Value.ToString('D') }
    if ($Value -is [DateTime]) {
        if ($Value.Kind -ne [DateTimeKind]::Utc) { throw 'Timestamp read back without UTC kind.' }
        return ([DateTime]::new($Value.Ticks - ($Value.Ticks % 10), [DateTimeKind]::Utc)).ToString('o')
    }
    if ($Value -is [bool]) { return $Value.ToString() }
    if ($Value -is [int]) { return $Value.ToString([Globalization.CultureInfo]::InvariantCulture) }
    if ($Value -is [string]) { return 's:' + $Value }
    throw "Unexpected value type $($Value.GetType().FullName)."
}

# ---- Load and validate the snapshot ----
$snapshotCounts = Get-Content (Join-Path $SnapshotDirectory 'counts.json') -Raw | ConvertFrom-Json -AsHashtable
$rowsByTable = [ordered]@{}
$expectedCanonical = @{}
$subMicrosecondValues = 0
foreach ($table in $tables.Keys) {
    $columns = $tables[$table]
    $doc = [System.Text.Json.JsonDocument]::Parse([IO.File]::ReadAllText((Join-Path $SnapshotDirectory "$table.json")))
    if ($doc.RootElement.ValueKind -ne 'Array') { throw "$table.json is not a JSON array." }
    $rows = [Collections.Generic.List[object[]]]::new()
    $index = 0
    foreach ($element in $doc.RootElement.EnumerateArray()) {
        $names = @($element.EnumerateObject() | ForEach-Object Name)
        $missing = @($columns.Keys | Where-Object { $_ -cnotin $names })
        $extra = @($names | Where-Object { $_ -cnotin $columns.Keys })
        if ($missing.Count -or $extra.Count) { throw "$table row $index columns differ from the expected set (missing: $($missing -join ','); extra: $($extra -join ','))." }
        $values = foreach ($column in $columns.Keys) {
            $v = ConvertTo-Value $columns[$column] $element.GetProperty($column) "$table row $index $column"
            if ($v -is [DateTime] -and ($v.Ticks % 10) -ne 0) { $subMicrosecondValues++ }
            , $v
        }
        $values = [object[]]$values
        if ($table -eq 'AccessKey' -and $values[2] -cnotmatch '^[0-9a-fA-F]{64}$') { throw "AccessKey row $index KeyHash is not 64 hex characters." }
        if ($table -eq 'Photo') {
            foreach ($pair in @(@{ i = 2; thumb = '' }, @{ i = 3; thumb = '_thumb' })) {
                $m = [regex]::Match($values[$pair.i], $sourceUrl)
                if (-not $m.Success -or $m.Groups['thumb'].Value -cne $pair.thumb -or
                    [Guid]$m.Groups['c'].Value -ne $values[1] -or [Guid]$m.Groups['p'].Value -ne $values[0]) {
                    throw "Photo row $index has an unexpected $(if ($pair.i -eq 2) { 'BlobUrl' } else { 'ThumbUrl' }); refusing to import."
                }
                $values[$pair.i] = "/images/$($m.Groups['c'].Value)/$($m.Groups['p'].Value)$($pair.thumb).jpg"
            }
        }
        $rows.Add($values)
        $index++
    }
    $doc.Dispose()
    if ($rows.Count -ne $expectedCounts[$table] -or $snapshotCounts[$table] -ne $rows.Count) {
        throw "$table snapshot has $($rows.Count) rows; counts.json says $($snapshotCounts[$table]); expected $($expectedCounts[$table])."
    }
    $rowsByTable[$table] = $rows
    $canon = [string[]]@($rows | ForEach-Object { ($_ | ForEach-Object { Format-Canonical $_ }) -join "`u{1F}" })
    [Array]::Sort($canon, [StringComparer]::Ordinal)
    $expectedCanonical[$table] = $canon
}
if (@($snapshotCounts.Keys | Where-Object { $_ -notin $tables.Keys }).Count) { throw 'counts.json lists a table this importer does not handle.' }

# ---- Import, verify, then commit or roll back ----
$connection = [Npgsql.NpgsqlConnection]::new($connectionString)
$connectionString = $null
$report = [ordered]@{}
try {
    $connection.Open()
    $tx = $connection.BeginTransaction()
    try {
        $all = ($tables.Keys | ForEach-Object { "public.$($_.ToLowerInvariant())" }) -join ', '
        $cmd = $connection.CreateCommand(); $cmd.Transaction = $tx
        $cmd.CommandText = "LOCK TABLE $all IN ACCESS EXCLUSIVE MODE"; [void]$cmd.ExecuteNonQuery(); $cmd.Dispose()
        foreach ($table in $tables.Keys) {
            $cmd = $connection.CreateCommand(); $cmd.Transaction = $tx
            $cmd.CommandText = "SELECT count(*) FROM public.$($table.ToLowerInvariant())"
            if ([long]$cmd.ExecuteScalar() -ne 0) { throw "Target table $table is not empty; refusing to import." }
            $cmd.Dispose()
        }

        foreach ($table in $tables.Keys) {
            $columns = @($tables[$table].Keys)
            $types = @($tables[$table].Values)
            $target = $table.ToLowerInvariant()
            $columnList = ($columns | ForEach-Object { $_.ToLowerInvariant() }) -join ', '
            $paramList = (0..($columns.Count - 1) | ForEach-Object { "@p$_" }) -join ', '
            $cmd = $connection.CreateCommand(); $cmd.Transaction = $tx
            $cmd.CommandText = "INSERT INTO public.$target ($columnList) VALUES ($paramList)"
            for ($c = 0; $c -lt $columns.Count; $c++) {
                $p = [Npgsql.NpgsqlParameter]::new("p$c", (Get-DbType $types[$c])); [void]$cmd.Parameters.Add($p)
            }
            foreach ($row in $rowsByTable[$table]) {
                for ($c = 0; $c -lt $columns.Count; $c++) { $cmd.Parameters[$c].Value = $row[$c] }
                if ($cmd.ExecuteNonQuery() -ne 1) { throw "Insert into $table did not affect exactly 1 row." }
            }
            $cmd.Dispose()

            # Full readback in the same fixed column order, compared canonically.
            $cmd = $connection.CreateCommand(); $cmd.Transaction = $tx
            $cmd.CommandText = "SELECT $columnList FROM public.$target"
            $reader = $cmd.ExecuteReader()
            $actual = [Collections.Generic.List[string]]::new()
            try {
                while ($reader.Read()) {
                    $vals = for ($c = 0; $c -lt $columns.Count; $c++) {
                        $v = $reader.GetValue($c)
                        if ($types[$c] -eq 'b' -and $v -isnot [bool]) { throw "$table.$($columns[$c]) did not read back as boolean." }
                        Format-Canonical $v
                    }
                    $actual.Add(($vals -join "`u{1F}"))
                }
            } finally { $reader.Dispose(); $cmd.Dispose() }
            $actualSorted = $actual.ToArray(); [Array]::Sort($actualSorted, [StringComparer]::Ordinal)
            $expected = $expectedCanonical[$table]
            if ($actualSorted.Count -ne $expected.Count) { throw "$table readback has $($actualSorted.Count) rows; expected $($expected.Count)." }
            for ($r = 0; $r -lt $expected.Count; $r++) {
                if ($actualSorted[$r] -cne $expected[$r]) { throw "$table readback differs from the snapshot (sorted row $r)." }
            }
            $report[$table] = $actualSorted.Count
        }

        if ($Commit) { $tx.Commit(); $status = 'Committed' } else { $tx.Rollback(); $status = 'VerifiedRolledBack' }
    } catch {
        try { $tx.Rollback() } catch { }
        throw
    } finally { $tx.Dispose() }
} finally { $connection.Dispose() }

[ordered]@{
    status                     = $status
    rows                       = $report
    totalRows                  = ($report.Values | Measure-Object -Sum).Sum
    photoUrlsRewritten         = 2 * $report['Photo']
    subMicrosecondTimestamps   = $subMicrosecondValues
    completedLocal             = [DateTimeOffset]::Now.ToString('o')
} | ConvertTo-Json -Depth 3
