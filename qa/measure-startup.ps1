param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$appPath = (Resolve-Path -LiteralPath $Executable).Path
$qaFolder = $PSScriptRoot
$measurements = @()
try {
    foreach ($attempt in 1..3) {
        $env:QINGMO_STARTUP_LOG = Join-Path $qaFolder "startup-$([Guid]::NewGuid().ToString('N')).txt"
        $appProcess = Start-Process -FilePath $appPath -PassThru -WindowStyle Hidden
        try {
            $deadline = (Get-Date).AddSeconds(25)
            while (-not (Test-Path -LiteralPath $env:QINGMO_STARTUP_LOG)) {
                if ($appProcess.HasExited) { throw "应用提前退出：$($appProcess.ExitCode)" }
                if ((Get-Date) -gt $deadline) { throw '等待编辑器就绪超时' }
                Start-Sleep -Milliseconds 100
            }
            $measurements += [int](Get-Content -LiteralPath $env:QINGMO_STARTUP_LOG)
        } finally {
            if (-not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id }
        }
    }
} finally {
    Remove-Item Env:QINGMO_STARTUP_LOG -ErrorAction SilentlyContinue
}
$report = [ordered]@{ executable = $appPath; bytes = (Get-Item -LiteralPath $appPath).Length; milliseconds = $measurements; metric = 'Rust main to editor ready; three consecutive launches, not a cold-boot benchmark' }
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaFolder 'startup-results.json') -Encoding utf8
$report | ConvertTo-Json
