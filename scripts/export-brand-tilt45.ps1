[CmdletBinding()]
param()

# Deterministic exports of the existing brand system, never a redrawn logo.
# Always read immutable v1 sources, so rerunning cannot rotate a mark twice.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'public/brand/v1'
$destination = Join-Path $root 'public/brand/tilt45-v1'
[System.IO.Directory]::CreateDirectory($destination) | Out-Null
[System.IO.Directory]::CreateDirectory((Join-Path $destination 'icons')) | Out-Null

function Export-RotatedIcon([string]$InputPath, [string]$OutputPath) {
    $inputImage = [System.Drawing.Bitmap]::new($InputPath)
    $outputImage = [System.Drawing.Bitmap]::new($inputImage.Width, $inputImage.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($outputImage)
    try {
        $graphics.Clear($inputImage.GetPixel(0, 0))
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.TranslateTransform($outputImage.Width / 2, $outputImage.Height / 2)
        $graphics.RotateTransform(-45)
        $graphics.DrawImage($inputImage, -$inputImage.Width / 2, -$inputImage.Height / 2, $inputImage.Width, $inputImage.Height)
        $outputImage.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose(); $outputImage.Dispose(); $inputImage.Dispose()
    }
}

Get-ChildItem -LiteralPath (Join-Path $source 'icons') -Filter '*.png' | ForEach-Object {
    Export-RotatedIcon $_.FullName (Join-Path $destination ('icons/' + $_.Name))
}

# The combined wordmark has its text starting at x=480. Keep those pixels
# horizontal and untouched; enlarge the canvas vertically to avoid clipping.
$wordmark = [System.Drawing.Bitmap]::new((Join-Path $source 'travkinflow-logo-154a0d68.png'))
$output = [System.Drawing.Bitmap]::new($wordmark.Width, 500)
$graphics = [System.Drawing.Graphics]::FromImage($output)
try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $state = $graphics.Save()
    $graphics.TranslateTransform(240, 250)
    $graphics.RotateTransform(-45)
    $graphics.DrawImage($wordmark, [System.Drawing.Rectangle]::new(-240, -97, 480, 195), 0, 0, 480, 195, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Restore($state)
    $graphics.DrawImage($wordmark, [System.Drawing.Rectangle]::new(480, 153, $wordmark.Width - 480, 195), 480, 0, $wordmark.Width - 480, 195, [System.Drawing.GraphicsUnit]::Pixel)
    $output.Save((Join-Path $destination 'wordmark.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose(); $output.Dispose(); $wordmark.Dispose()
}

Get-ChildItem -LiteralPath $destination -Recurse -File | ForEach-Object {
    $image = [System.Drawing.Image]::FromFile($_.FullName)
    try { '{0}: {1}x{2}' -f $_.Name, $image.Width, $image.Height } finally { $image.Dispose() }
}
