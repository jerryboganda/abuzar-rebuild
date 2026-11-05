param([Parameter(Mandatory=$true)][long]$Hwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CW {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
[CW]::PostMessage([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
"closed $Hwnd"
