# Capture the currently open original report window (MDI child) to PNG + JSON.
#   powershell -File old-capture-report.ps1 -Out x.png [-Json x.json]
param([string]$Out = 'C:\Projects\Abuzar\deploy\parity\old-final\report.png', [string]$Json = '', [switch]$Close, [switch]$Maximize, [int]$Width = 0, [int]$Height = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class Cap {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static string Text(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h, s, s.Capacity); return s.ToString(); }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
  public static string Rect(IntPtr h) { RECT r; if (!GetWindowRect(h, out r)) return ""; return string.Format("{0},{1} {2}x{3}", r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top); }
  public static List<IntPtr> Tops(uint pid) { var r = new List<IntPtr>(); EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p); if(p==pid) r.Add(h); return true;}, IntPtr.Zero); return r; }
  public static List<IntPtr> Kids(IntPtr p) { var r = new List<IntPtr>(); EnumChildWindows(p,(h,l)=>{r.Add(h);return true;},IntPtr.Zero); return r; }
}
"@
$p = Get-Process abuzar -ErrorAction Stop | Select-Object -First 1
$tops = [Cap]::Tops([uint32]$p.Id)
$all = @()
foreach ($t in $tops) { $all += $t; foreach ($k in [Cap]::Kids($t)) { $all += $k } }
"windows with a Report: title:"
foreach ($h in $all) {
  $txt = [Cap]::Text($h); if ($txt -match '^Report:') { "  hwnd=$h class=$([Cap]::Class($h)) rect=$([Cap]::Rect($h)) visible=$([Cap]::IsWindowVisible($h)) text=$txt" }
}
$report = $all | Where-Object { ([Cap]::Text($_)) -match '^Report:' -and [Cap]::IsWindowVisible($_) } | Select-Object -First 1
if (-not $report) { throw 'no visible Report: window found' }
[Cap]::SetForegroundWindow($report) | Out-Null
if ($Maximize) { [Cap]::ShowWindow($report, 3) | Out-Null }
if ($Width -gt 0 -and $Height -gt 0) { [Cap]::SetWindowPos($report, [IntPtr]::Zero, 0, 0, $Width, $Height, 0x0006) | Out-Null }
Start-Sleep -Milliseconds 1200
$r = New-Object Cap+RECT
[Cap]::GetWindowRect($report, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $Out ($w x $ht) from '$([Cap]::Text($report))'"
if ($Json) {
  $rows = [Cap]::Kids($report) | ForEach-Object {
    [pscustomobject]@{ hwnd = $_; class = [Cap]::Class($_); text = [Cap]::Text($_); rect = [Cap]::Rect($_); visible = [Cap]::IsWindowVisible($_) }
  }
  [pscustomobject]@{ hwnd = $report; class = [Cap]::Class($report); title = [Cap]::Text($report); rect = [Cap]::Rect($report); controls = $rows } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $Json
  "wrote $Json"
}
if ($Close) {
  [Cap]::PostMessage($report, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  "closed report window $report"
  Start-Sleep -Milliseconds 800
}
