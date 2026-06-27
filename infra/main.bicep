targetScope = 'subscription'

@description('Base name used to derive resource names.')
param namePrefix string = 'webinv'

@description('Location for new resources.')
param location string = 'eastus'

@description('Location for the Static Web App (limited region set).')
param swaLocation string = 'eastus2'

@description('Azure OpenAI location that has gpt-4o-mini capacity.')
param openAiLocation string = 'eastus'

@description('Existing SQL server name (without .database.windows.net).')
param sqlServerName string = 'sqlgkhw25ijhyzzy'

@description('Existing SQL database name.')
param sqlDatabaseName string = 'webportfolio'

var rgName = 'rg-${namePrefix}'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
  location: location
}

module resources 'resources.bicep' = {
  name: 'webinventory-resources'
  scope: rg
  params: {
    namePrefix: namePrefix
    location: location
    swaLocation: swaLocation
    openAiLocation: openAiLocation
    sqlServerName: sqlServerName
    sqlDatabaseName: sqlDatabaseName
  }
}

output resourceGroupName string = rg.name
output staticWebAppName string = resources.outputs.staticWebAppName
output functionAppName string = resources.outputs.functionAppName
output functionPrincipalId string = resources.outputs.functionPrincipalId
output storageAccountName string = resources.outputs.storageAccountName
output openAiEndpoint string = resources.outputs.openAiEndpoint
output sqlConnectionString string = resources.outputs.sqlConnectionString
