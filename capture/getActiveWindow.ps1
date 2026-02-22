Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@

$hwnd = [FocusWin]::GetForegroundWindow()
$sb   = New-Object System.Text.StringBuilder 1024
[FocusWin]::GetWindowText($hwnd, $sb, 1024) | Out-Null

$pid2 = [uint32]0
[FocusWin]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null

$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue

[PSCustomObject]@{
  title     = $sb.ToString()
  appName   = if ($proc) { $proc.ProcessName } else { 'Unknown' }
  processId = $pid2
} | ConvertTo-Json -Compress
