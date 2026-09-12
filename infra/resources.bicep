@description('Base name used to derive resource names.')
param namePrefix string

param location string
param openAiLocation string
param sqlServerName string
param sqlDatabaseName string

@description('Suffix in the live resource names. Pinned because the stack predates this template and uniqueString() does not reproduce it.')
param resourceSuffix string = 'xkedjbjx'

@description('Name of the shared Log Analytics workspace to reuse for App Insights.')
param sharedLogAnalyticsName string = 'loggkhw25ijhyzzy'

@description('Resource group of the shared Log Analytics workspace.')
param sharedLogAnalyticsResourceGroup string = 'investmentportfolio'

var storageName = toLower('st${namePrefix}${substring(resourceSuffix, 0, 8)}')
var functionAppName = '${namePrefix}-api-${substring(resourceSuffix, 0, 6)}'
var planName = '${namePrefix}-plan'
var openAiName = '${namePrefix}-openai-${substring(resourceSuffix, 0, 6)}'
var swaName = '${namePrefix}-web'
var aiName = '${namePrefix}-ai'

// ---------------------------------------------------------------- Storage
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource photosContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'photos'
  properties: { publicAccess: 'None' }
}

// ---------------------------------------------------------------- App Insights
// Cost consolidation: reuse the shared Log Analytics workspace in the
// investmentportfolio RG (1 GB/day cap) instead of a per-app workspace. The
// old per-app `${namePrefix}-logs` workspace was deleted.
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: sharedLogAnalyticsName
  scope: resourceGroup(sharedLogAnalyticsResourceGroup)
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ---------------------------------------------------------------- Azure OpenAI
resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAiName
  location: openAiLocation
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: openAiName
    publicNetworkAccess: 'Enabled'
  }
}

resource visionModel 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAi
  name: 'gpt-5-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5-mini'
      version: '2025-08-07'
    }
  }
}

// ---------------------------------------------------------------- Function App (consumption)
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNET-ISOLATED|8.0'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      cors: {
        // Free SWA: the SPA calls this Function cross-origin, so allow the SWA's
        // (auto-generated) hostname. Referencing swa.properties.defaultHostname is
        // now possible because the linkedBackend (which created a circular dep) is
        // gone. supportCredentials stays false — auth is the x-api-key header.
        allowedOrigins: [ 'https://${swa.properties.defaultHostname}', 'http://localhost:5173' ]
      }
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'dotnet-isolated' }
        // NOTE: On Linux Consumption, WEBSITE_RUN_FROM_PACKAGE must be a blob SAS URL,
        // which the deployment (functions-action) sets automatically. Do not hardcode '1'.
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'SqlConnectionString', value: 'Server=tcp:${sqlServerName}${environment().suffixes.sqlServerHostname},1433;Database=${sqlDatabaseName};Encrypt=True;TrustServerCertificate=False;' }
        { name: 'BlobAccountUrl', value: storage.properties.primaryEndpoints.blob }
        { name: 'BlobContainerName', value: 'photos' }
        { name: 'OpenAiEndpoint', value: openAi.properties.endpoint }
        { name: 'OpenAiDeployment', value: 'gpt-5-mini' }
        // KeyAuthMiddleware defaults this to true when absent, which would re-accept the
        // SWA principal. Declared so a deploy cannot silently widen auth.
        { name: 'WEBINV_ALLOW_SWA_PRINCIPAL', value: 'false' }
      ]
    }
  }
}

// ---------------------------------------------------------------- Static Web App (Free)
// Free SKU: no linked backend (that requires Standard). The SPA calls the
// Function App directly (cross-origin) via VITE_API_BASE; the Function's CORS
// allows this SWA's origin and the SPA CSP connect-src includes the Function.
// Read-only: the GitHub integration owns repositoryUrl/branch/provider, and declaring
// the site here would strip them on every deploy.
resource swa 'Microsoft.Web/staticSites@2023-12-01' existing = {
  name: swaName
}

// ---------------------------------------------------------------- Role assignments
var blobDataContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var openAiUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, blobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: blobDataContributor
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource openAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAi.id, functionApp.id, openAiUser)
  scope: openAi
  properties: {
    roleDefinitionId: openAiUser
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output staticWebAppName string = swa.name
output functionAppName string = functionApp.name
output functionPrincipalId string = functionApp.identity.principalId
output storageAccountName string = storage.name
output openAiEndpoint string = openAi.properties.endpoint
output sqlConnectionString string = 'Server=tcp:${sqlServerName}${environment().suffixes.sqlServerHostname},1433;Database=${sqlDatabaseName};Encrypt=True;TrustServerCertificate=False;'
