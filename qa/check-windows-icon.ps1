param([Parameter(Mandatory=$true)][string]$Executable, [int]$AppProcessId = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class QingmoWindowInfo {
    public IntPtr Handle;
    public string Title;
    public IntPtr Icon;
}
public static class QingmoIconCheck {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] private static extern IntPtr GetClassLongPtr(IntPtr hwnd, int index);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] private static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
    public static IntPtr Extract(string file) {
        var large = new IntPtr[1];
        if (ExtractIconEx(file, 0, large, null, 1) == 0) throw new Exception("Executable has no icon");
        return large[0];
    }
    public static QingmoWindowInfo[] Windows(int processId) {
        var result = new List<QingmoWindowInfo>();
        EnumWindows((hwnd, data) => {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            if (pid != processId) return true;
            var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
            var icon = SendMessage(hwnd, 127, new IntPtr(1), IntPtr.Zero);
            if (icon == IntPtr.Zero) icon = SendMessage(hwnd, 127, IntPtr.Zero, IntPtr.Zero);
            if (icon == IntPtr.Zero) icon = GetClassLongPtr(hwnd, -14);
            result.Add(new QingmoWindowInfo { Handle=hwnd, Title=title.ToString(), Icon=icon });
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
'@
$exePath = (Resolve-Path -LiteralPath $Executable).Path
$handle = [QingmoIconCheck]::Extract($exePath)
try {
    $actual = [System.Drawing.Icon]::FromHandle($handle).ToBitmap()
    $expected = [System.Drawing.Bitmap]::new((Join-Path $PSScriptRoot '..\src-tauri\icons\32x32.png'))
    if ($actual.Size -ne $expected.Size) { throw "Icon size mismatch: $($actual.Size)" }
    $difference = 0.0
    for ($y = 0; $y -lt $actual.Height; $y++) {
        for ($x = 0; $x -lt $actual.Width; $x++) {
            $a = $actual.GetPixel($x,$y); $b = $expected.GetPixel($x,$y)
            $difference += [Math]::Abs([int]$a.A - $b.A)
            if ($a.A -gt 20 -or $b.A -gt 20) {
                $difference += [Math]::Abs([int]$a.R - $b.R) + [Math]::Abs([int]$a.G - $b.G) + [Math]::Abs([int]$a.B - $b.B)
            }
        }
    }
    $meanDifference = $difference / ($actual.Width * $actual.Height * 4)
    $actual.Save((Join-Path $PSScriptRoot 'icon-executable.png'))
    $actual.Dispose(); $expected.Dispose()
    if ($meanDifference -gt 3) { throw "Embedded executable icon differs from current icon (mean channel difference $meanDifference)" }
    Write-Output "Executable icon matches: mean channel difference $meanDifference"
} finally { [void][QingmoIconCheck]::DestroyIcon($handle) }
if ($AppProcessId) {
    $windows = [QingmoIconCheck]::Windows($AppProcessId)
    $main = $windows | Where-Object { $_.Title -like '*轻墨*' } | Select-Object -First 1
    if (-not $main) { throw 'Could not find the Qingmo document window' }
    if ($main.Icon -eq [IntPtr]::Zero) { throw 'Document window has no icon' }
    $bitmap = [System.Drawing.Icon]::FromHandle($main.Icon).ToBitmap()
    $bitmap.Save((Join-Path $PSScriptRoot 'icon-taskbar-window.png'))
    Write-Output "Window icon extracted: $($main.Title), $($bitmap.Size)"
    $bitmap.Dispose()
}
