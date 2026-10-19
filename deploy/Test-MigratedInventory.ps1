[CmdletBinding()]
param(
    [string]$Base='https://jimbrownhome1.tail8ad282.ts.net:8795',
    [Parameter(Mandatory)][string]$ImagePath
)
$ErrorActionPreference='Stop'
function JsonRequest([string]$Method,[string]$Path,$Body){
    $options=@{Uri="$Base/api/$Path";Method=$Method;TimeoutSec=30}
    if($null -ne $Body){$options.ContentType='application/json';$options.Body=$Body|ConvertTo-Json -Depth 10}
    Invoke-RestMethod @options
}
$before=ConvertTo-Json -InputObject @(JsonRequest Get containers $null) -Depth 20 -Compress
$testIds=[Collections.Generic.List[string]]::new()
$lookupIds=@{}
try{
    foreach($kind in 'owners','locations','categories'){
        $lookup=JsonRequest Post "lookups/$kind" @{name="Migration validation $([guid]::NewGuid().ToString('N'))"}
        $lookupIds[$kind]=$lookup.id
    }
    $mutation=[guid]::NewGuid().ToString()
    $inputData=@{name='Migration validation';locationId=$lookupIds.locations;ownerId=$lookupIds.owners;notes='Temporary isolated test';clientMutationId=$mutation}
    $first=JsonRequest Post containers $inputData
    $testIds.Add([string]$first.id)
    $replay=JsonRequest Post containers $inputData
    if($replay.id -ne $first.id){throw 'Container replay duplicated data.'}
    $second=JsonRequest Post containers @{name='Migration move target'}
    $testIds.Add([string]$second.id)
    $itemMutation=[guid]::NewGuid().ToString()
    $itemInput=@{name='Migration validation item';quantity=2;tags=@('migration-test');categoryId=$lookupIds.categories;clientMutationId=$itemMutation}
    $item=JsonRequest Post "containers/$($first.id)/items" $itemInput
    $itemReplay=JsonRequest Post "containers/$($first.id)/items" $itemInput
    if($itemReplay.id -ne $item.id){throw 'Item replay duplicated data.'}
    $results=JsonRequest Get 'search?q=migration%20validation%20item' $null
    if(@($results.items|Where-Object id -eq $item.id).Count -ne 1){throw 'Case-insensitive search failed.'}
    $null=JsonRequest Post "items/$($item.id)/move" @{targetContainerId=$second.id}
    $photoMutation=[guid]::NewGuid().ToString()
    $photo=Invoke-RestMethod "$Base/api/containers/$($first.id)/photos?analyze=false" -Method Post -ContentType image/jpeg -InFile $ImagePath -Headers @{'X-Client-Mutation-Id'=$photoMutation} -TimeoutSec 30
    $photoReplay=Invoke-RestMethod "$Base/api/containers/$($first.id)/photos?analyze=false" -Method Post -ContentType image/jpeg -InFile $ImagePath -Headers @{'X-Client-Mutation-Id'=$photoMutation} -TimeoutSec 30
    if($photoReplay.photoId -ne $photo.photoId){throw 'Photo replay duplicated data.'}
    $null=JsonRequest Post "photos/$($photo.photoId)/rotate?degrees=90" $null
    $detail=JsonRequest Get "containers/$($first.id)" $null
    if($detail.photos.Count -ne 1){throw 'Photo readback differs.'}
    foreach($url in $detail.photos[0].blobUrl,$detail.photos[0].thumbUrl){
        $result=Invoke-WebRequest "$Base$url"
        if($result.StatusCode -ne 200){throw 'Uploaded image cannot be read.'}
    }
    $null=JsonRequest Post "photos/$($photo.photoId)/move" @{targetContainerId=$second.id}
    $moved=JsonRequest Get "containers/$($second.id)" $null
    if($moved.items.Count -ne 1 -or $moved.photos.Count -ne 1){throw 'Move readback differs.'}
    'Verified lookups, containers, items, tags, search, upload, thumbnail, rotation, moves and replay IDs.'
}finally{
    foreach($id in $testIds){$null=JsonRequest Delete "containers/$id" $null}
    foreach($kind in $lookupIds.Keys){$null=JsonRequest Delete "lookups/$kind/$($lookupIds[$kind])" $null}
}
$after=ConvertTo-Json -InputObject @(JsonRequest Get containers $null) -Depth 20 -Compress
if($before -cne $after){throw 'Original containers changed during isolated test.'}
'Temporary objects removed; original containers unchanged. Orphan test tags must be cleaned by the reviewed final cleanup.'
