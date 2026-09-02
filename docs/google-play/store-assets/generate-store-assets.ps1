[CmdletBinding()]
param(
    [string]$OutputDirectory = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$wordmarkPath = Join-Path $projectRoot 'public\brand\v1\travkinflow-logo-154a0d68.png'
$iconPath = Join-Path $projectRoot 'android\app\src\main\res\drawable\travkinflow_icon.png'
$featurePath = Join-Path $OutputDirectory 'feature-graphic-1024x500.png'
$storeIconPath = Join-Path $OutputDirectory 'play-store-icon-512.png'

foreach ($requiredPath in @($wordmarkPath, $iconPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required authoritative brand asset is missing: $requiredPath"
    }
}

if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}

$bitmap = [System.Drawing.Bitmap]::new(1024, 500, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$bitmap.SetResolution(96, 96)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

try {
    $canvas = [System.Drawing.Rectangle]::new(0, 0, 1024, 500)
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $canvas,
        [System.Drawing.ColorTranslator]::FromHtml('#F8F4E8'),
        [System.Drawing.ColorTranslator]::FromHtml('#DED5BB'),
        12
    )
    try {
        $graphics.FillRectangle($background, $canvas)
    }
    finally {
        $background.Dispose()
    }

    $dark = [System.Drawing.ColorTranslator]::FromHtml('#0F1115')
    $gold = [System.Drawing.ColorTranslator]::FromHtml('#E0B100')
    $softGold = [System.Drawing.Color]::FromArgb(92, 224, 177, 0)
    $softDark = [System.Drawing.Color]::FromArgb(35, 15, 17, 21)

    $darkBrush = [System.Drawing.SolidBrush]::new($dark)
    $softDarkBrush = [System.Drawing.SolidBrush]::new($softDark)
    $goldPen = [System.Drawing.Pen]::new($gold, 3)
    $softGoldPen = [System.Drawing.Pen]::new($softGold, 1)
    try {
        $leftField = [System.Drawing.Point[]]@(
            [System.Drawing.Point]::new(0, 0),
            [System.Drawing.Point]::new(220, 0),
            [System.Drawing.Point]::new(128, 142),
            [System.Drawing.Point]::new(0, 196)
        )
        $rightField = [System.Drawing.Point[]]@(
            [System.Drawing.Point]::new(1024, 500),
            [System.Drawing.Point]::new(770, 500),
            [System.Drawing.Point]::new(882, 350),
            [System.Drawing.Point]::new(1024, 302)
        )
        $graphics.FillPolygon($darkBrush, $leftField)
        $graphics.FillPolygon($darkBrush, $rightField)

        for ($offset = -80; $offset -le 1120; $offset += 64) {
            $graphics.DrawLine($softGoldPen, $offset, 0, $offset - 180, 500)
        }

        $graphics.FillRectangle($softDarkBrush, 0, 228, 1024, 44)
        $graphics.DrawLine($goldPen, 0, 226, 1024, 226)
        $graphics.DrawLine($goldPen, 0, 274, 1024, 274)
    }
    finally {
        $darkBrush.Dispose()
        $softDarkBrush.Dispose()
        $goldPen.Dispose()
        $softGoldPen.Dispose()
    }

    $wordmark = [System.Drawing.Image]::FromFile($wordmarkPath)
    try {
        $targetWidth = 820
        $targetHeight = [int][Math]::Round($targetWidth * $wordmark.Height / $wordmark.Width)
        $targetX = [int](($bitmap.Width - $targetWidth) / 2)
        $targetY = [int](($bitmap.Height - $targetHeight) / 2)
        $graphics.DrawImage($wordmark, $targetX, $targetY, $targetWidth, $targetHeight)
    }
    finally {
        $wordmark.Dispose()
    }

    $bitmap.Save($featurePath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}

[System.IO.File]::Copy($iconPath, $storeIconPath, $true)

$feature = [System.Drawing.Image]::FromFile($featurePath)
$icon = [System.Drawing.Image]::FromFile($storeIconPath)
try {
    if ($feature.Width -ne 1024 -or $feature.Height -ne 500) {
        throw 'Generated feature graphic has an invalid canvas size.'
    }
    if (($feature.PixelFormat -band [System.Drawing.Imaging.PixelFormat]::Alpha) -ne 0) {
        throw 'Generated feature graphic unexpectedly contains alpha.'
    }
    if ($icon.Width -ne 512 -or $icon.Height -ne 512) {
        throw 'Store icon does not have the required 512x512 dimensions.'
    }
}
finally {
    $feature.Dispose()
    $icon.Dispose()
}

Get-Item -LiteralPath $featurePath, $storeIconPath |
    Select-Object FullName, Length, @{Name = 'SHA256'; Expression = { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } }
