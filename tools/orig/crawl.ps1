# Drives the RUNNING ORIGINAL (abuzar.exe) for the fidelity comparison: dumps its live menu tree (with command ids) and opens
# menu commands by id, saving a screenshot of each result.  Read-only use: the item list below skips everything that acts on data.
#   powershell -NoProfile -File crawl.ps1 dump <out.tsv>
#   powershell -NoProfile -File crawl.ps1 open <ids.txt> <outdir> [settle-ms]     ids.txt: "id<TAB>path" lines
param([string]$Mode, [string]$A1, [string]$A2, [int]$Settle = 2500)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
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
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> Top(uint pid) { var r = new List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(128); GetClassName(h, sb, 128); return sb.ToString(); }
  public static string Txt(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static IntPtr Find(IntPtr parent, string cls) { IntPtr found = IntPtr.Zero; EnumChildWindows(parent, (h, l) => { if (Cls(h) == cls) { found = h; return false; } return true; }, IntPtr.Zero); return found; }
  public static void Walk(IntPtr m, string path, List<string> o) {
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
      o.Add(string.Format("{0}\t{1}\t{2}\t{3}", id, sub != IntPtr.Zero ? "menu" : sep ? "sep" : "item", (st & 0x3) != 0 ? "disabled" : "", p));
      if (sub != IntPtr.Zero) Walk(sub, p, o);
    }
  }
}
"@
[void][W]::SetProcessDPIAware()
$proc = Get-Process abuzar | Select-Object -First 1
$pid_ = [uint32]$proc.Id
function Frame { foreach ($h in [W]::Top($pid_)) { if ([W]::Cls($h) -eq 'FNWND3125' -and [W]::IsWindowVisible($h)) { return $h } } }
# what is on the screen inside the window's rectangle (PrintWindow leaves the DataWindow children blank); the program is kept topmost so
# nothing else (the chat window ...) is drawn over it
function Shot($h, $path) {
  [void][W]::SetWindowPos($h, [IntPtr]::new(-1), 0, 0, 0, 0, 0x43)
  Start-Sleep -Milliseconds 250
  $r = New-Object W+RECT
  [void][W]::GetWindowRect($h, [ref]$r)
  $x = [Math]::Max(0, $r.L); $y = [Math]::Max(0, $r.T)
  $w = [Math]::Min(1920, $r.R) - $x; $ht = [Math]::Min(1080, $r.B) - $y
  $b = New-Object System.Drawing.Bitmap $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.CopyFromScreen($x, $y, 0, 0, $b.Size)
  $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $b.Dispose()
}
function StableShot($frame, $png) {
  $prev = ''
  for ($i = 0; $i -lt 14; $i++) {
    Shot $frame $png
    $hash = (Get-FileHash $png -Algorithm MD5).Hash
    if ($hash -eq $prev) { break }
    $prev = $hash; Start-Sleep -Milliseconds 800
  }
}
function Others($frame) { @([W]::Top($pid_) | Where-Object { $_ -ne $frame -and [W]::IsWindowVisible($_) -and ([W]::Cls($_) -notin @('PBTooltips16_100', 'MSCTFIME UI', 'IME')) }) }
# click the button of a dialog that dismisses it without doing anything: Cancel / Close / No / Exit, else Ok
function Dismiss($h) {
  $btns = @()
  [W]::EnumChildWindows($h, { param($c, $l) if ([W]::Cls($c) -eq 'Button') { $script:btns += , @($c, ([W]::Txt($c) -replace '&', '')) }; $true }, [IntPtr]::Zero) | Out-Null
  foreach ($want in 'Cancel', 'Close', 'No', 'Exit', 'Ok', 'OK', 'Yes') {
    foreach ($b in $script:btns) { if ($b[1] -eq $want) { [void][W]::PostMessage($b[0], 0xF5, [IntPtr]::Zero, [IntPtr]::Zero); return $true } }
  }
  return $false
}
# close every dialog / message box, then the active sheet; answers "save changes?" with No
function Cleanup($frame) {
  for ($round = 0; $round -lt 8; $round++) {
    $o = Others $frame
    if ($o.Count -gt 0) {
      foreach ($h in $o) {
        $script:btns = @()
        if (-not (Dismiss $h)) { [void][W]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
      }
      Start-Sleep -Milliseconds 700
      continue
    }
    $mdi = [W]::Find($frame, 'MDIClient')
    $act = [W]::SendMessage($mdi, 0x229, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($act -eq [IntPtr]::Zero) { break }
    [void][W]::PostMessage($act, 0x112, [IntPtr]0xF060, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 700
  }
}
$frame = Frame
if ($Mode -eq 'prep') {
  [void][W]::ShowWindow($frame, 3)
  [void][W]::SetForegroundWindow($frame)
  Cleanup $frame
  "prepared"
}
elseif ($Mode -eq 'dump') {
  $o = New-Object 'System.Collections.Generic.List[string]'
  [W]::Walk([W]::GetMenu($frame), '', $o)
  $o | Out-File -Encoding utf8 $A1
  "$($o.Count) entries"
}
elseif ($Mode -eq 'open') {
  New-Item -ItemType Directory -Force $A2 | Out-Null
  $n = 0
  foreach ($line in (Get-Content $A1)) {
    $id, $path = $line -split "`t", 2
    if (-not $id) { continue }
    $n++
    $name = ('{0}_' -f $id) + (($path -replace '[^A-Za-z0-9]+', '_').Trim('_'))
    if ($name.Length -gt 120) { $name = $name.Substring(0, 120) }
    $frame = Frame
    for ($w = 0; -not $frame -and $w -lt 40; $w++) { Start-Sleep -Seconds 1; $frame = Frame }
    if (-not $frame) { "{0}`t{1}`tNOFRAME`t{2}" -f $n, $id, $path; continue }
    Cleanup $frame
    [void][W]::ShowWindow($frame, 3)
    [void][W]::SetForegroundWindow($frame)
    [void][W]::PostMessage($frame, 0x111, [IntPtr][int]$id, [IntPtr]::Zero)
    Start-Sleep -Milliseconds $Settle
    $others = (Others $frame | ForEach-Object { [W]::Cls($_) + ':' + [W]::Txt($_) }) -join ' ; '
    $mdi = [W]::Find($frame, 'MDIClient')
    $act = [W]::SendMessage($mdi, 0x229, [IntPtr]::Zero, [IntPtr]::Zero)
    $sheet = if ($act -ne [IntPtr]::Zero) { [W]::Txt($act) } else { '' }
    if (-not [W]::IsZoomed($frame)) { [void][W]::ShowWindow($frame, 3); Start-Sleep -Milliseconds 700 }
    StableShot $frame (Join-Path $A2 "$name.png")
    $k = 0
    foreach ($o in (Others $frame)) { $k++; Shot $o (Join-Path $A2 "${name}_dlg$k.png") }
    # menu of the frame while this sheet is active (sheets bring their own menu bar)
    $m = New-Object 'System.Collections.Generic.List[string]'
    [W]::Walk([W]::GetMenu($frame), '', $m)
    $m | Out-File -Encoding utf8 (Join-Path $A2 "$name.menu.tsv")
    $top = ($m | Where-Object { ($_ -split "`t")[3] -notmatch ' \| ' } | ForEach-Object { ($_ -split "`t")[3] }) -join ','
    "{0}`t{1}`tsheet=[{2}]`tdialogs=[{3}]`tmenubar=[{4}]`t{5}" -f $n, $id, $sheet, $others, $top, $path
    # an entry window opens with no form until "New" is used: capture that state, too
    $newId = ($m | Where-Object { ($_ -split "`t")[3] -match '^&File \| &New' -and ($_ -split "`t")[2] -ne 'disabled' } | ForEach-Object { ($_ -split "`t")[0] } | Select-Object -First 1)
    if ($newId -and -not (Others $frame)) {
      [void][W]::PostMessage($frame, 0x111, [IntPtr][int]$newId, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 1200
      StableShot $frame (Join-Path $A2 "${name}_new.png")
      foreach ($o in (Others $frame)) { $k++; Shot $o (Join-Path $A2 "${name}_new_dlg$k.png") }
    }
    Cleanup $frame
  }
}
