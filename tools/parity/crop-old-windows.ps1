# Crop each original non-report screenshot to its captured window rectangle.
# The old JSON files carry the exact Win32 window bounds; the desktop position
# must not be part of the visual comparison with the rebuild's clipped window.
# Usage: powershell -NoProfile -File crop-old-windows.ps1 <olddir> <outdir>
param([string]$OldDir, [string]$OutDir)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
foreach ($png in Get-ChildItem $OldDir -Filter '*.png') {
  $json = Join-Path $OldDir ($png.BaseName + '.json')
  if (-not (Test-Path $json)) { continue }
  $raw = Get-Content $json -Raw
  $data = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
  $win = $data.windows | Where-Object { -not $_.isFrame -and $_.w -gt 100 -and $_.h -gt 100 } | Select-Object -First 1
  if (-not $win) { continue }
  $src = [System.Drawing.Image]::FromFile($png.FullName)
  try {
    $x = [Math]::Max(0, [int]$win.x)
    $y = [Math]::Max(0, [int]$win.y)
    $w = [Math]::Min([int]$win.w, $src.Width - $x)
    $h = [Math]::Min([int]$win.h, $src.Height - $y)
    if ($w -le 0 -or $h -le 0) { continue }
    $rect = New-Object System.Drawing.Rectangle $x, $y, $w, $h
    $crop = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($crop)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $rect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $crop.Save((Join-Path $OutDir $png.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $crop.Dispose()
  } finally { $src.Dispose() }
}
$count = (Get-ChildItem $OutDir -Filter '*.png').Count
"cropped $count old windows"
