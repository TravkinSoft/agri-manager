param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$SheetName
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-EntryText {
  param([System.IO.Compression.ZipArchiveEntry]$Entry)
  $reader = [System.IO.StreamReader]::new($Entry.Open())
  try { $reader.ReadToEnd() } finally { $reader.Close() }
}

function Get-XmlNodeText {
  param($Node)

  if ($null -eq $Node) {
    return ""
  }

  if ($Node -is [System.Array]) {
    $parts = @()
    foreach ($item in $Node) {
      $parts += (Get-XmlNodeText -Node $item)
    }
    return ($parts -join "")
  }

  if ($Node -is [System.Xml.XmlElement]) {
    return [string]$Node.InnerText
  }

  return [string]$Node
}

function Get-ColKey {
  param([string]$CellRef)
  return ($CellRef -replace '[0-9]', '')
}

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "File not found: $FilePath"
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($FilePath)
try {
  $workbookEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/workbook.xml" } | Select-Object -First 1
  $relsEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/_rels/workbook.xml.rels" } | Select-Object -First 1
  $sharedEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/sharedStrings.xml" } | Select-Object -First 1

  if (-not $workbookEntry -or -not $relsEntry -or -not $sharedEntry) {
    throw "Invalid XLSX structure: workbook/rels/sharedStrings is missing."
  }

  $workbookXml = [xml](Read-EntryText -Entry $workbookEntry)
  $relsXml = [xml](Read-EntryText -Entry $relsEntry)
  $sharedXml = [xml](Read-EntryText -Entry $sharedEntry)

  $shared = New-Object System.Collections.Generic.List[string]
  foreach ($si in $sharedXml.sst.si) {
    if ($si.t) {
      [void]$shared.Add((Get-XmlNodeText -Node $si.t).Trim())
      continue
    }
    $text = ""
    foreach ($run in $si.r) {
      $text += (Get-XmlNodeText -Node $run.t)
    }
    [void]$shared.Add($text)
  }

  $sheetNode = $workbookXml.workbook.sheets.sheet | Where-Object { $_.name -eq $SheetName } | Select-Object -First 1
  if (-not $sheetNode) {
    throw "Sheet '$SheetName' not found."
  }

  $rid = $null
  if ($sheetNode.PSObject.Properties.Match("r:id").Count -gt 0) {
    $rid = [string]$sheetNode.'r:id'
  }
  if (-not $rid -and $sheetNode.PSObject.Properties.Match("id").Count -gt 0) {
    $rid = [string]$sheetNode.id
  }
  if (-not $rid) {
    throw "Cannot resolve relationship id for sheet '$SheetName'."
  }
  $relNode = $relsXml.Relationships.Relationship | Where-Object { $_.Id -eq $rid } | Select-Object -First 1
  if (-not $relNode) {
    throw "Workbook relation for sheet '$SheetName' not found."
  }

  $sheetPath = "xl/" + ([string]$relNode.Target).Replace("\", "/").TrimStart("/")
  $sheetEntry = $zip.Entries | Where-Object { $_.FullName -eq $sheetPath } | Select-Object -First 1
  if (-not $sheetEntry) {
    throw "Sheet XML entry not found: $sheetPath"
  }

  $sheetXml = [xml](Read-EntryText -Entry $sheetEntry)
  $rows = @($sheetXml.worksheet.sheetData.row)
  if ($rows.Count -eq 0) {
    throw "Sheet '$SheetName' has no rows."
  }

  $headerByCol = @{}
  foreach ($cell in @($rows[0].c)) {
    $col = Get-ColKey -CellRef ([string]$cell.r)
    $value = ""
    if ([string]$cell.t -eq "s" -and $cell.v -ne $null) {
      $value = $shared[[int]$cell.v]
    } elseif ($cell.is -and $cell.is.t) {
      $value = (Get-XmlNodeText -Node $cell.is.t).Trim()
    } elseif ($cell.v -ne $null) {
      $value = (Get-XmlNodeText -Node $cell.v).Trim()
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $headerByCol[$col] = $value.Trim()
    }
  }

  $headerList = New-Object System.Collections.Generic.List[string]
  foreach ($name in $headerByCol.Values) {
    if (-not [string]::IsNullOrWhiteSpace($name)) {
      [void]$headerList.Add($name)
    }
  }

  $rowResults = New-Object System.Collections.Generic.List[object]
  for ($idx = 1; $idx -lt $rows.Count; $idx++) {
    $rowNode = $rows[$idx]
    $cellByCol = @{}
    foreach ($cell in @($rowNode.c)) {
      $col = Get-ColKey -CellRef ([string]$cell.r)
      $value = ""
      if ([string]$cell.t -eq "s" -and $cell.v -ne $null) {
        $value = $shared[[int]$cell.v]
      } elseif ($cell.is -and $cell.is.t) {
        $value = (Get-XmlNodeText -Node $cell.is.t).Trim()
      } elseif ($cell.v -ne $null) {
        $value = (Get-XmlNodeText -Node $cell.v).Trim()
      }
      $cellByCol[$col] = $value
    }

    $outCells = @{}
    foreach ($col in $headerByCol.Keys) {
      $headerName = [string]$headerByCol[$col]
      if ([string]::IsNullOrWhiteSpace($headerName)) {
        continue
      }
      $outCells[$headerName] = if ($cellByCol.ContainsKey($col)) { [string]$cellByCol[$col] } else { "" }
    }

    $rowObject = [pscustomobject]@{
      rowIndex = if ($rowNode.r) { [int]$rowNode.r } else { $idx + 1 }
      cells = $outCells
    }
    [void]$rowResults.Add($rowObject)
  }

  $result = [pscustomobject]@{
    filePath = $FilePath
    sheetName = $SheetName
    headers = $headerList.ToArray()
    rows = $rowResults.ToArray()
  }

  $result | ConvertTo-Json -Depth 12 -Compress
}
finally {
  $zip.Dispose()
}
