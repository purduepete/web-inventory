targetScope = 'subscription'

@description('Base name used to derive resource names.')
param namePrefix string = 'webinv'

@description('Location for new resources.')
param location string = 'eastus'

@description('Azure OpenAI location that has gpt-5-mini capacity.')
param openAiLocation string = 'eastus'

@description('Existing SQL server name (without .database.windows.net).')
param sqlServerName string = 'sqlgkhw25ijhyzzy'

@description('Existing SQL database name.')
param sqlDatabaseName string = 'webportfolio'

@description('Resource group that already holds the stack.')
param rgName string = 'jimbpersonal-rg'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' existing = {
  name: rgName
}

module resources 'resources.bicep' = {
  name: 'webinventory-resources'
  scope: rg
  params: {
    namePrefix: namePrefix
    location: location
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
