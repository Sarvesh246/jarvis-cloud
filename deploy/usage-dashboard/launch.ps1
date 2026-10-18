$ErrorActionPreference = 'Stop'
$workerPath = Join-Path $PSScriptRoot 'sync.py'
$configPath = Join-Path $PSScriptRoot 'config.json'
$pythonPath = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python312/python.exe'
$logPath = Join-Path $PSScriptRoot 'worker.log'
Set-Location -LiteralPath $PSScriptRoot
& $pythonPath $workerPath --config $configPath *> $logPath
exit $LASTEXITCODE
