# Captures the running original screen by screen: every window/control of the process,
# the active sheet, its menu bar, dialogs, and a screenshot. Read-only: it opens each
# menu command, answers save/close prompts with No/Cancel, then closes the sheet again.
#   powershell -NoProfile -File capture-old.ps1 <ids.tsv> <outdir> [settle-ms]
# ids.tsv lines: "<command-id><TAB><caption path>"
param([string]$Ids, [string]$OutDir, [int]$Settle = 4500)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PW {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr m, int pos);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr m, uint pos, StringBuilder sb, int max, uint flags);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr m, uint pos, uint flags);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr m, int pos);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> Top(uint pid) { var r = new List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(128); GetClassName(h, sb, 128); return sb.ToString(); }
  public static string Txt(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static IntPtr Find(IntPtr parent, string cls) { IntPtr found = IntPtr.Zero; EnumChildWindows(parent, (h, l) => { if (Cls(h) == cls) { found = h; return false; } return true; }, IntPtr.Zero); return found; }
  public static void Walk(IntPtr m, string path, List<string[]> o) {
    int n = GetMenuItemCount(m);
    for (int i = 0; i < n; i++) {
      var sb = new StringBuilder(256);
      GetMenuString(m, (uint)i, sb, 256, 0x400);
      uint st = GetMenuState(m, (uint)i, 0x400);
      IntPtr sub = GetSubMenu(m, i);
      string cap = sb.ToString();
      bool sep = sub == IntPtr.Zero && (st & 0x800) != 0;
      string p = path + (path.Length > 0 ? " | " : "") + (sep ? "----" : cap.Replace("\t", " <TAB> "));
      uint id = sub == IntPtr.Zero ? GetMenuItemID(m, i) : 0;
      o.Add(new string[] { id.ToString(), sub != IntPtr.Zero ? "menu" : sep ? "sep" : "item", (st & 0x3) != 0 ? "disabled" : "", p });
      if (sub != IntPtr.Zero) Walk(sub, p, o);
    }
  }
}
"@
[void][PW]::SetProcessDPIAware()
$proc = Get-Process abuzar | Select-Object -First 1
if (-not $proc) { throw 'abuzar.exe is not running' }
$pid_ = [uint32]$proc.Id
function Frame { foreach ($h in [PW]::Top($pid_)) { if ([PW]::Cls($h) -eq 'FNWND3125' -and [PW]::IsWindowVisible($h)) { return $h } } }
function Others($frame) { @([PW]::Top($pid_) | Where-Object { $_ -ne $frame -and [PW]::IsWindowVisible($_) -and ([PW]::Cls($_) -notin @('PBTooltips16_100', 'MSCTFIME UI', 'IME')) }) }
function Snap($h) {
  $r = New-Object PW+RECT
  [void][PW]::GetWindowRect($h, [ref]$r)
  $x = [Math]::Max(0, $r.L); $y = [Math]::Max(0, $r.T)
  $w = [Math]::Min(1920, $r.R) - $x; $ht = [Math]::Min(1080, $r.B) - $y
  if ($w -le 0 -or $ht -le 0) { return $null }
  $b = New-Object System.Drawing.Bitmap $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.CopyFromScreen($x, $y, 0, 0, $b.Size)
  $g.Dispose()
  return $b
}
function Shot($h, $path) {
  [void][PW]::SetWindowPos($h, [IntPtr]::new(-1), 0, 0, 0, 0, 0x43)
  Start-Sleep -Milliseconds 150
  $b = Snap $h
  if ($b) { $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose() }
}
function StableShot($frame, $path) {
  [void][PW]::SetWindowPos($frame, [IntPtr]::new(-1), 0, 0, 0, 0, 0x43)
  Start-Sleep -Milliseconds 150
  $prev = ''; $b = $null
  for ($i = 0; $i -lt 14; $i++) {
    if ($b) { $b.Dispose() }
    $b = Snap $frame
    if (-not $b) { break }
    $t = New-Object System.Drawing.Bitmap $b, 160, 90
    $ms = New-Object System.IO.MemoryStream
    $t.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $t.Dispose()
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hash = [BitConverter]::ToString($md5.ComputeHash($ms.ToArray()))
    if ($hash -eq $prev) { break }
    $prev = $hash; Start-Sleep -Milliseconds 500
  }
  if ($b) { $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose() }
}
function Dismiss($h) {
  $script:btns = @()
  [PW]::EnumChildWindows($h, { param($c, $l) if ([PW]::Cls($c) -eq 'Button') { $script:btns += , @($c, ([PW]::Txt($c) -replace '&', '')) }; $true }, [IntPtr]::Zero) | Out-Null
  $order = if (($script:btns | Where-Object { $_[1] -eq 'Yes' }) -and ($script:btns | Where-Object { $_[1] -eq 'No' })) { @('No') } else { @('Cancel', 'Close', 'No', 'Exit', 'Ok', 'OK', 'Yes') }
  foreach ($want in $order) { foreach ($b in $script:btns) { if ($b[1] -eq $want) { [void][PW]::PostMessage($b[0], 0xF5, [IntPtr]::Zero, [IntPtr]::Zero); return $true } } }
  return $false
}
function Cleanup($frame) {
  for ($round = 0; $round -lt 10; $round++) {
    $o = Others $frame
    if ($o.Count -gt 0) {
      foreach ($h in $o) { if (-not (Dismiss $h)) { [void][PW]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) } }
      Start-Sleep -Milliseconds 400; continue
    }
    $mdi = [PW]::Find($frame, 'MDIClient')
    $act = [PW]::SendMessage($mdi, 0x229, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($act -eq [IntPtr]::Zero) { break }
    [void][PW]::PostMessage($act, 0x112, [IntPtr]0xF060, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 400
  }
}
function Meta($frame) {
  $fr = New-Object PW+RECT
  [void][PW]::GetWindowRect($frame, [ref]$fr)
  $wins = New-Object System.Collections.ArrayList
  $winControls = New-Object System.Collections.ArrayList
  foreach ($h in [PW]::Top($pid_)) {
    if (-not [PW]::IsWindowVisible($h)) { continue }
    if ([PW]::Cls($h) -in @('PBTooltips16_100', 'MSCTFIME UI', 'IME')) { continue }
    $r = New-Object PW+RECT
    [void][PW]::GetWindowRect($h, [ref]$r)
    $isFrame = ($h -eq $frame)
    [void]$wins.Add([ordered]@{ hwnd = $h.ToInt64(); class = [PW]::Cls($h); title = [PW]::Txt($h); x = ($r.L - $fr.L); y = ($r.T - $fr.T); w = ($r.R - $r.L); h = ($r.B - $r.T); enabled = [PW]::IsWindowEnabled($h); isFrame = $isFrame })
    $script:winControls = New-Object System.Collections.ArrayList
    [PW]::EnumChildWindows($h, { param($c, $l)
      $cr = New-Object PW+RECT
      [void][PW]::GetWindowRect($c, [ref]$cr)
      $p = [PW]::GetParent($c)
      [void]$script:winControls.Add([ordered]@{ top = $h.ToInt64(); hwnd = $c.ToInt64(); parent = $p.ToInt64(); parentClass = [PW]::Cls($p); class = [PW]::Cls($c); text = [PW]::Txt($c); visible = [PW]::IsWindowVisible($c); enabled = [PW]::IsWindowEnabled($c); x = ($cr.L - $fr.L); y = ($cr.T - $fr.T); w = ($cr.R - $cr.L); h = ($cr.B - $cr.T) })
      $true }, [IntPtr]::Zero) | Out-Null
    foreach ($c in $script:winControls) { [void]$winControls.Add($c) }
  }
  $script:captureControls = New-Object System.Collections.ArrayList
  [PW]::EnumChildWindows($frame, { param($c, $l)
    $r = New-Object PW+RECT
    [void][PW]::GetWindowRect($c, [ref]$r)
    $p = [PW]::GetParent($c)
    [void]$script:captureControls.Add([ordered]@{ hwnd = $c.ToInt64(); parent = $p.ToInt64(); parentClass = [PW]::Cls($p); class = [PW]::Cls($c); text = [PW]::Txt($c); visible = [PW]::IsWindowVisible($c); enabled = [PW]::IsWindowEnabled($c); x = ($r.L - $fr.L); y = ($r.T - $fr.T); w = ($r.R - $r.L); h = ($r.B - $r.T) })
    $true }, [IntPtr]::Zero) | Out-Null
  $controls = $script:captureControls
  $mdi = [PW]::Find($frame, 'MDIClient')
  $act = [PW]::SendMessage($mdi, 0x229, [IntPtr]::Zero, [IntPtr]::Zero)
  $sheet = $null
  if ($act -ne [IntPtr]::Zero) {
    $sr = New-Object PW+RECT
    [void][PW]::GetWindowRect($act, [ref]$sr)
    $sheet = [ordered]@{ hwnd = $act.ToInt64(); class = [PW]::Cls($act); title = [PW]::Txt($act); x = ($sr.L - $fr.L); y = ($sr.T - $fr.T); w = ($sr.R - $sr.L); h = ($sr.B - $sr.T); visible = [PW]::IsWindowVisible($act); enabled = [PW]::IsWindowEnabled($act) }
  }
  $menu = New-Object 'System.Collections.Generic.List[string[]]'
  [PW]::Walk([PW]::GetMenu($frame), '', $menu)
  return [ordered]@{ frame = [ordered]@{ x = $fr.L; y = $fr.T; w = ($fr.R - $fr.L); h = ($fr.B - $fr.T) }; sheet = $sheet; windows = $wins; controls = $controls; winControls = $winControls; menu = $menu }
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
$n = 0; $log = New-Object System.Collections.ArrayList
foreach ($line in (Get-Content $Ids)) {
  if (-not $line.Trim()) { continue }
  $id, $path = $line -split "`t", 2
  if (-not $id -or -not $path) { continue }
  $n++
  $name = ('{0:D3}' -f $n) + '_' + (($path -replace '[^A-Za-z0-9]+', '_').Trim('_'))
  if ($name.Length -gt 120) { $name = $name.Substring(0, 120) }
  $frame = Frame
  for ($w = 0; -not $frame -and $w -lt 8; $w++) { Start-Sleep -Seconds 1; $frame = Frame }
  if (-not $frame) { [void]$log.Add([ordered]@{ n = $n; id = $id; path = $path; outcome = 'NOFRAME' }); break }
  Cleanup $frame
  [void][PW]::ShowWindow($frame, 3)
  [void][PW]::SetForegroundWindow($frame)
  [void][PW]::PostMessage($frame, 0x111, [IntPtr][int]$id, [IntPtr]::Zero)
  Start-Sleep -Milliseconds $Settle
  $meta = Meta $frame
  if (-not [PW]::IsZoomed($frame)) { [void][PW]::ShowWindow($frame, 3); Start-Sleep -Milliseconds 500 }
  StableShot $frame (Join-Path $OutDir "$name.png")
  $meta | ConvertTo-Json -Depth 8 | Out-File -Encoding utf8 (Join-Path $OutDir "$name.json")
  $dk = 0
  foreach ($win in $meta.windows) {
    if ($win.isFrame) { continue }
    $dk++
    $h = [IntPtr]::new([int64]$win.hwnd)
    Shot $h (Join-Path $OutDir ("${name}_dlg{0}.png" -f $dk))
  }
  # the same sheet after File | New (entry windows show their empty form)
  $newDone = $false
  $newId = ($meta.menu | Where-Object { $_[3] -match '^&File \| &New' -and $_[2] -ne 'disabled' } | Select-Object -First 1)
  if ($newId) {
    [void][PW]::PostMessage($frame, 0x111, [IntPtr][int]$newId[0], [IntPtr]::Zero)
    Start-Sleep -Milliseconds 1600
    $metaNew = Meta $frame
    StableShot $frame (Join-Path $OutDir "${name}_new.png")
    $metaNew | ConvertTo-Json -Depth 8 | Out-File -Encoding utf8 (Join-Path $OutDir "${name}_new.json")
    $dk = 0
    foreach ($win in $metaNew.windows) {
      if ($win.isFrame) { continue }
      $dk++
      Shot ([IntPtr]::new([int64]$win.hwnd)) (Join-Path $OutDir ("${name}_new_dlg{0}.png" -f $dk))
    }
    $newDone = $true
  }
  $dialogs = @($meta.windows | Where-Object { -not $_.isFrame }).Count
  [void]$log.Add([ordered]@{ n = $n; id = $id; path = $path; outcome = 'OK'; sheetClass = $(if ($meta.sheet) { $meta.sheet.class } else { '' }); sheetTitle = $(if ($meta.sheet) { $meta.sheet.title } else { '' }); controls = $meta.controls.Count; windows = $meta.windows.Count; dialogs = $dialogs; newForm = $newDone })
  Cleanup $frame
  Start-Sleep -Milliseconds 250
}
$log | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 (Join-Path $OutDir 'screens.json')
$log | Format-Table n, id, outcome, sheetClass, sheetTitle, controls, windows, dialogs, newForm -AutoSize | Out-String | Write-Output
