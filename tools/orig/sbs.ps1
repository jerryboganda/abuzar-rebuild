# sbs.ps1 <original.png> <rebuild.png> <out.png> [scale] - the two screenshots next to each other (original left, rebuild right), both scaled
param([string]$InA, [string]$InB, [string]$Out, [double]$Scale = 0.5)
Add-Type -AssemblyName System.Drawing
$a = [System.Drawing.Bitmap]::FromFile($InA)
$b = [System.Drawing.Bitmap]::FromFile($InB)
$w1 = [int]($a.Width * $Scale); $h1 = [int]($a.Height * $Scale)
$w2 = [int]($b.Width * $Scale); $h2 = [int]($b.Height * $Scale)
$dst = New-Object System.Drawing.Bitmap ($w1 + $w2 + 6), ([Math]::Max($h1, $h2))
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.Clear([System.Drawing.Color]::FromArgb(255, 0, 120, 215))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($a, 0, 0, $w1, $h1)
$g.DrawImage($b, $w1 + 6, 0, $w2, $h2)
$dst.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $dst.Dispose(); $a.Dispose(); $b.Dispose()
