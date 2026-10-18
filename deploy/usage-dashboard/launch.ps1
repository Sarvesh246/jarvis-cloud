$ErrorActionPreference = 'Stop'
$workerPath = Join-Path $PSScriptRoot 'sync.py'
$configPath = Join-Path $PSScriptRoot 'config.json'
$pythonPath = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python312/python.exe'
Set-Location -LiteralPath $PSScriptRoot
& $pythonPath $workerPath --config $configPath
exit $LASTEXITCODE
