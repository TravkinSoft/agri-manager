param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "File not found: $FilePath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::OpenRead($FilePath)
try {
  $entry = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" } | Select-Object -First 1
  if (-not $entry) {
    throw "word/document.xml not found in DOCX"
  }

  $reader = New-Object System.IO.StreamReader($entry.Open())
  $xmlText = $reader.ReadToEnd()
  $reader.Close()

  [xml]$xml = $xmlText
  $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")

  $tables = $xml.SelectNodes("//w:tbl", $ns)
  if (-not $tables -or $tables.Count -eq 0) {
    $result = @{
      filePath = $FilePath
      tableCount = 0
      headers = @()
      rows = @()
    }
    $result | ConvertTo-Json -Depth 8 -Compress
    exit 0
  }

  $table = $tables.Item(0)
  $rowNodes = $table.SelectNodes(".//w:tr", $ns)
  if (-not $rowNodes -or $rowNodes.Count -eq 0) {
    $result = @{
      filePath = $FilePath
      tableCount = $tables.Count
      headers = @()
      rows = @()
    }
    $result | ConvertTo-Json -Depth 8 -Compress
    exit 0
  }

  $headerCells = $rowNodes.Item(0).SelectNodes("./w:tc", $ns)
  $headers = @()
  foreach ($cell in $headerCells) {
    $textParts = $cell.SelectNodes(".//w:t", $ns) | ForEach-Object { $_.InnerText }
    $headerText = ($textParts -join "").Trim()
    if (-not $headerText) {
      $headerText = "col_$($headers.Count + 1)"
    }
    $headers += $headerText
  }

  $rows = @()
  for ($r = 1; $r -lt $rowNodes.Count; $r++) {
    $cells = $rowNodes.Item($r).SelectNodes("./w:tc", $ns)
    $cellMap = @{}
    $nonEmpty = 0
    for ($c = 0; $c -lt $headers.Count; $c++) {
      $value = ""
      if ($c -lt $cells.Count) {
        $textParts = $cells.Item($c).SelectNodes(".//w:t", $ns) | ForEach-Object { $_.InnerText }
        $value = ($textParts -join "").Trim()
      }
      if ($value) { $nonEmpty++ }
      $cellMap[$headers[$c]] = $value
    }
    if ($nonEmpty -eq 0) { continue }

    $rows += @{
      rowIndex = $r + 1
      cells = $cellMap
    }
  }

  $result = @{
    filePath = $FilePath
    tableCount = $tables.Count
    headers = $headers
    rowCount = $rows.Count
    rows = $rows
  }
  $result | ConvertTo-Json -Depth 12 -Compress
}
finally {
  $zip.Dispose()
}
