# Compare the old and new screenshots of the same screen by numeric prefix.
# Usage: powershell -NoProfile -File compare-images.ps1 <olddir> <newdir> <out.csv> [x] [y] [w] [h]
param([string]$OldDir, [string]$NewDir, [string]$OutCsv, [int]$X = 0, [int]$Y = 80, [int]$W = 1900, [int]$H = 900)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class ImgDiff {
  public static string Diff(string a, string b, int x, int y, int w, int h) {
    using (var A = new Bitmap(a)) using (var B = new Bitmap(b)) {
      int ww = Math.Min(w, Math.Min(A.Width, B.Width) - x);
      int hh = Math.Min(h, Math.Min(A.Height, B.Height) - y);
      if (ww <= 0 || hh <= 0) return "0,0,0";
      var ra = new Rectangle(x, y, ww, hh);
      var da = A.LockBits(ra, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      var db = B.LockBits(ra, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      try {
        int stride = da.Stride;
        byte[] ba = new byte[stride * hh];
        byte[] bb = new byte[stride * hh];
        Marshal.Copy(da.Scan0, ba, 0, ba.Length);
        Marshal.Copy(db.Scan0, bb, 0, bb.Length);
        long sum = 0; long over = 0; long n = 0;
        for (int row = 0; row < hh; row++) {
          int o = row * stride;
          for (int i = 0; i < ww * 3; i += 3) {
            int d = Math.Abs(ba[o+i] - bb[o+i]) + Math.Abs(ba[o+i+1] - bb[o+i+1]) + Math.Abs(ba[o+i+2] - bb[o+i+2]);
            sum += d / 3; if (d / 3 > 40) over++; n++;
          }
        }
        return string.Format("{0:0.00},{1:0.00},{2}", (double)sum / n, 100.0 * over / n, n);
      } finally { A.UnlockBits(da); B.UnlockBits(db); }
    }
  }
}
"@
function RoleSuffix([string]$name) {
  if ($name -match '(_dlg\d+|_s\d+)\.png$') { return $Matches[1] }
  return ''
}
$rows = @()
$old = Get-ChildItem $OldDir -Filter '*.png' | Sort-Object Name
foreach ($o in $old) {
  $prefix = $o.Name.Substring(0, 3)
  $suffix = RoleSuffix $o.Name
  if ($suffix) {
    # a modal/dialog capture only pairs with the same dialog on the new side
    $n = Get-ChildItem $NewDir -Filter "$prefix*$suffix.png" | Select-Object -First 1
  } else {
    # the main screen only pairs with a main-screen capture, not a dialog
    $n = Get-ChildItem $NewDir -Filter "$prefix*.png" | Where-Object { (RoleSuffix $_.Name) -eq '' } | Select-Object -First 1
  }
  if (-not $n) { $rows += [pscustomobject]@{ n = [int]$prefix; old = $o.Name; new = ''; mae = ''; pct40 = '' }; continue }
  $r = [ImgDiff]::Diff($o.FullName, $n.FullName, $X, $Y, $W, $H)
  $p = $r.Split(',')
  $rows += [pscustomobject]@{ n = [int]$prefix; old = $o.Name; new = $n.Name; mae = $p[0]; pct40 = $p[1] }
}
$rows | Sort-Object n | Export-Csv -NoTypeInformation -Encoding UTF8 $OutCsv
$rows | Sort-Object { [double]$_.pct40 } -Descending | Select-Object -First 15 | Format-Table -AutoSize
"written $OutCsv"
