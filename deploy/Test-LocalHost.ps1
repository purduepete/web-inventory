[CmdletBinding()]
param([Parameter(Mandatory)][string]$ReleasePath,[Parameter(Mandatory)][string]$ImageDirectory)
$ErrorActionPreference='Stop'
$previous=@{}
foreach($key in 'ImageDirectory','PostgresConnectionString'){$previous[$key]=[Environment]::GetEnvironmentVariable($key)}
$env:ImageDirectory=$ImageDirectory
$env:PostgresConnectionString='Host=127.0.0.1;Port=1;Database=web_inventory;Username=invalid;Password=invalid;Timeout=1'
$out=Join-Path ([IO.Path]::GetTempPath()) ("inventory-test-"+[guid]::NewGuid().ToString('N')+'.out')
$err="$out.err"
$process=$null
try{
    $process=Start-Process (Join-Path $ReleasePath 'WebInventory.Api.exe') -WorkingDirectory $ReleasePath -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    for($i=0;$i -lt 30;$i++){
        Start-Sleep -Milliseconds 250
        if($process.HasExited){throw "Host failed: $(Get-Content $err -Raw)"}
        if((Get-Content $out -Raw) -match 'Now listening'){break}
    }
    foreach($case in @(
        @{Path='/api/auth/check';Code=204;Headers=@{}}
        @{Path='/';Code=200;Headers=@{}}
        @{Path='/manifest.webmanifest';Code=200;Headers=@{}}
        @{Path='/api/auth/check';Code=403;Headers=@{Origin='https://untrusted.example'}}
        @{Path='/api/containers';Code=500;Headers=@{}}
    )){
        $result=Invoke-WebRequest ("http://127.0.0.1:18795"+$case.Path) -Headers $case.Headers -SkipHttpErrorCheck
        if([int]$result.StatusCode -ne $case.Code){throw "Unexpected status for $($case.Path): $($result.StatusCode)"}
        "Verified $($case.Path): $($case.Code)"
    }
}finally{
    if($process -and -not $process.HasExited){Stop-Process -Id $process.Id -Force}
    foreach($key in $previous.Keys){[Environment]::SetEnvironmentVariable($key,$previous[$key])}
    Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
}
