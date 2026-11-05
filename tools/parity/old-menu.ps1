# Resolve and invoke a menu path in the original PowerBuilder app through its
# real Win32 HMENU, then answer report dialogs and capture the final preview.
#   powershell -File old-menu.ps1 -Path "Reports|Daily Reports|Sale|Sale detail" -DryRun
#   powershell -File old-menu.ps1 -Path "..." -Out out.png [-Json out.json]
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [string]$Out = '',
  [string]$Json = '',
  [switch]$DryRun,
  [int]$TimeoutSec = 60,
  [int]$SettleMs = 2500
)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class OldMenu {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr m, uint i, StringBuilder s, int n, uint flags);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr m, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr m, int i);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static string Text(IntPtr h) { var s = new StringBuilder(1024); GetWindowText(h, s, s.Capacity); return s.ToString(); }
  public static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
  public static string Rect(IntPtr h) { RECT r; if (!GetWindowRect(h, out r)) return ""; return string.Format("{0},{1} {2}x{3}", r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top); }
  public static void Click(IntPtr h) { SendMessage(h, 0x00F5, IntPtr.Zero, IntPtr.Zero); }
  public static List<IntPtr> Tops(uint pid) { var r = new List<IntPtr>(); EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p); if(p==pid) r.Add(h); return true;}, IntPtr.Zero); return r; }
  public static List<IntPtr> Kids(IntPtr p) { var r = new List<IntPtr>(); EnumChildWindows(p,(h,l)=>{r.Add(h);return true;},IntPtr.Zero); return r; }
}
"@
function Norm([string]$s) { return ($s -replace '&','' -replace '\s+',' ').Trim().ToLowerInvariant() }
function Resolve-Menu([IntPtr]$h, [string[]]$parts) {
  $menu = [OldMenu]::GetMenu($h)
  if ($menu -eq [IntPtr]::Zero) { throw 'no menu' }
  $cur = $menu
  for ($p = 0; $p -lt $parts.Count; $p++) {
    $want = Norm $parts[$p]
    $count = [OldMenu]::GetMenuItemCount($cur)
    $found = -1
    for ($i = 0; $i -lt $count; $i++) {
      $sb = New-Object Text.StringBuilder 512
      [OldMenu]::GetMenuString($cur, [uint32]$i, $sb, 512, 0x400) | Out-Null
      if ((Norm $sb.ToString()) -eq $want) { $found = $i; break }
    }
    if ($found -lt 0) {
      $names = @()
      for ($i = 0; $i -lt $count; $i++) { $sb = New-Object Text.StringBuilder 512; [OldMenu]::GetMenuString($cur, [uint32]$i, $sb, 512, 0x400) | Out-Null; $names += (Norm $sb.ToString()) }
      throw "menu part '$($parts[$p])' not found; have: $($names -join ', ')"
    }
    if ($p -eq $parts.Count - 1) { return [OldMenu]::GetMenuItemID($cur, $found) }
    $sub = [OldMenu]::GetSubMenu($cur, $found)
    if ($sub -eq [IntPtr]::Zero) { throw "menu part '$($parts[$p])' has no submenu" }
    $cur = $sub
  }
}
$proc = Get-Process abuzar -ErrorAction Stop | Select-Object -First 1
$h = $proc.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { throw 'main window handle is zero' }
[OldMenu]::ShowWindow($h, 9) | Out-Null
[OldMenu]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400
$parts = $Path -split '\|' | ForEach-Object { $_.Trim() }
$id = Resolve-Menu $h $parts
"resolved id=$id path=$($parts -join ' > ')"
if ($DryRun) { return }
[OldMenu]::SendMessage($h, 0x0111, [IntPtr]$id, [IntPtr]::Zero) | Out-Null
"sent WM_COMMAND $id"

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$clicked = 0
$seen = @{}
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  $tops = [OldMenu]::Tops([uint32]$proc.Id) | Where-Object { [OldMenu]::IsWindowVisible($_) }
  $answered = $false
  foreach ($t in $tops) {
    $title = [OldMenu]::Text($t)
    $cls = [OldMenu]::Class($t)
    if ($cls -eq 'FNWND3125') { continue }
    $kids = [OldMenu]::Kids($t)
    $ok = $null
    foreach ($k in $kids) {
      $kt = [OldMenu]::Text($k)
      $kc = [OldMenu]::Class($k)
      if ($kc -match 'Button' -and (Norm $kt) -eq 'ok') { $ok = $k; break }
      if ($kc -match 'Button' -and (Norm $kt) -eq 'cancel') { $ok = $k; break }
    }
    if ($ok -ne $null) {
      [OldMenu]::Click($ok)
      $clicked++
      "answered dialog '$title' ($cls) -> clicked ok/cancel ($clicked)"
      $answered = $true
      Start-Sleep -Milliseconds 900
      break
    }
  }
  if ($answered) { continue }
  $all = @()
  foreach ($t in $tops) { $all += $t; foreach ($k in [OldMenu]::Kids($t)) { $all += $k } }
  $report = $all | Where-Object { ([OldMenu]::Text($_)) -match '^Report:' -and [OldMenu]::IsWindowVisible($_) } | Select-Object -First 1
  if ($report) {
    Start-Sleep -Milliseconds $SettleMs
    $title = [OldMenu]::Text($report)
    $rect = [OldMenu]::Rect($report)
    "report window '$title' rect=$rect"
    if ($Out) {
      $r = New-Object OldMenu+RECT
      [OldMenu]::GetWindowRect($report, [ref]$r) | Out-Null
      $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
      $bmp = New-Object System.Drawing.Bitmap $w, $ht
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht))
      $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose()
      "saved $Out"
    }
    if ($Json) {
      $win = @()
      foreach ($t in $tops) {
        $kids = [OldMenu]::Kids($t) | ForEach-Object {
          [pscustomobject]@{ hwnd = $_; class = [OldMenu]::Class($_); text = [OldMenu]::Text($_); rect = [OldMenu]::Rect($_) }
        }
        $win += [pscustomobject]@{ hwnd = $t; class = [OldMenu]::Class($t); title = [OldMenu]::Text($t); rect = [OldMenu]::Rect($t); controls = $kids }
      }
      $win | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $Json
      "wrote $Json"
    }
    return
  }
}
"no report window before timeout; clicked=$clicked"
$tops = [OldMenu]::Tops([uint32]$proc.Id) | Where-Object { [OldMenu]::IsWindowVisible($_) }
foreach ($t in $tops) { "  window '$([OldMenu]::Text($t))' class=$([OldMenu]::Class($t)) rect=$([OldMenu]::Rect($t))" }
