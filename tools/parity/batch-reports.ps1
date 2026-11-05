param([int]$From = 6, [int]$To = 14, [string]$Screens = '', [switch]$OldOnly)
# Batch final-preview capture with hard per-step timeouts (Playwright can hang
# in browser.close() when a headless browser dies; the process tree is killed).
$root = 'C:\Projects\Abuzar\deploy\parity'
function Invoke-Timeout([string]$file, [string]$argLine, [string]$workdir, [int]$seconds) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $file
  $psi.Arguments = $argLine
  $psi.WorkingDirectory = $workdir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $done = $p.WaitForExit($seconds * 1000)
  if (-not $done) {
    try { $p.Kill($true) } catch {}
    return @{ ok = $false; out = "TIMEOUT after ${seconds}s" }
  }
  $out = $p.StandardOutput.ReadToEnd()
  $err = $p.StandardError.ReadToEnd()
  return @{ ok = ($p.ExitCode -eq 0); out = ($out + $err) }
}
$screensFile = if ($Screens) { $Screens } else { Join-Path $root 'screen-parity\old-reports\screens.json' }
$screenList = Get-Content $screensFile -Raw | ConvertFrom-Json
"type=$($screenList.GetType().FullName) n0=$($screenList[0].n)"
$targets = $screenList | Where-Object { $_.n -ge $From -and $_.n -le $To } | Sort-Object n
"batch from=$From to=$To screens=$screensFile loaded=$($screenList.Count) targets=$(@($targets).Count)"
foreach ($t in $targets) {
  $n = '{0:000}' -f [int]$t.n
  $slug = (($t.path -replace '&','') -replace '[^A-Za-z0-9]+','_').Trim('_')
  $oldOut = Join-Path $root "old-final\${n}_$slug.png"
  $newOut = Join-Path $root "new-final\${n}_$slug.png"
  "=== $n $($t.path) $(Get-Date -Format o)"
  $oldArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$root\old-menu.ps1`" -Path `"$($t.path)`" -Out `"$oldOut`" -TimeoutSec 25 -SettleMs 3500"
  $r1 = Invoke-Timeout 'powershell.exe' $oldArgs $root 60
  "old: $($r1.ok) $((($r1.out -split "`n") | Select-Object -Last 2) -join ' / ')"
  $capArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$root\old-capture-report.ps1`" -Out `"$oldOut`" -Width 650 -Height 504 -Close"
  $r2 = Invoke-Timeout 'powershell.exe' $capArgs $root 20
  "old-close: $($r2.ok)"
  $newPath = $t.path -replace '&',''
  if ($OldOnly) { continue }
  $nodeArgs = "`"$root\pw\probe-report-generic.mjs`" `"$newPath`" `"$newOut`" `"$($newOut -replace '\.png$','.json')`""
  $r3 = Invoke-Timeout 'node.exe' $nodeArgs $root 120
  $v = ($r3.out -split "`n" | Select-String -Pattern '"rows"|"fatal"|"title"' | Select-Object -First 3) -join ' / '
  "new: $($r3.ok) $v"
}
