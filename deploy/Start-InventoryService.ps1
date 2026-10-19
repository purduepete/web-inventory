[CmdletBinding()]
param([string]$AppRoot='C:\ProgramData\SolutionDeploy\apps\web-inventory')
$ErrorActionPreference='Stop'
try {
    $settings=Get-Content "$AppRoot\shared\secrets\settings.json" -Raw|ConvertFrom-Json -AsHashtable
    foreach($key in $settings.Keys){[Environment]::SetEnvironmentVariable($key,[string]$settings[$key])}
    $settings=$null
    $release=Split-Path $PSScriptRoot -Parent
    Set-Location $release
    & "$release\WebInventory.Api.exe" *>> "$AppRoot\shared\logs\web-inventory.log"
    if($LASTEXITCODE){throw "WebInventory exited with code $LASTEXITCODE."}
} catch {
    "Startup failed: $($_.Exception.Message)"|Add-Content "$AppRoot\shared\logs\startup-error.log"
    throw
}
