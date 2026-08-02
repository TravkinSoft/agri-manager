param(
  [Parameter(Mandatory = $true)]
  [string]$CsvPath,
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$BearerToken,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$rows = Import-Csv -LiteralPath $CsvPath -Encoding UTF8
$payloadRows = @($rows | ForEach-Object {
  $country = switch ($_.('Страна').Trim()) {
    'Казахстан' { 'KZ' }
    'Россия' { 'RU' }
    default { '' }
  }
  [ordered]@{
    legal_name = $_.('Юридическое название').Trim()
    tax_id = [string]$_.('БИН/ИНН').Trim()
    country_code = $country
  }
})

$body = @{
  rows = $payloadRows
  dryRun = -not $Apply.IsPresent
} | ConvertTo-Json -Depth 5 -Compress

$headers = @{ Authorization = "Bearer $BearerToken" }
$result = Invoke-RestMethod `
  -Method Post `
  -Uri ($ApiBaseUrl.TrimEnd('/') + '/api/global-admin/counterparties/import') `
  -Headers $headers `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))

$result | ConvertTo-Json -Depth 8
