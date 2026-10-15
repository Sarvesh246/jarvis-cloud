param(
    [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64',
    [string]$BinaryPath,
    [string]$OutputDirectory = 'src-tauri/target/msix',
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$webRoot = Split-Path -Parent $PSScriptRoot
Push-Location $webRoot
try {
    $target = if ($Architecture -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
    if (-not $SkipBuild) {
        $env:VITE_VAELO_STORE = '1'
        & npm.cmd run tauri -- build --no-bundle --target $target
        if ($LASTEXITCODE -ne 0) { throw 'The Store application build failed.' }
    }
    if (-not $BinaryPath) { $BinaryPath = "src-tauri/target/$target/release/vaelo-desktop.exe" }
    if (-not (Test-Path -LiteralPath $BinaryPath)) { throw "The application binary was not found: $BinaryPath" }
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $version = "$($config.version).0"
    if ($version -notmatch '^\d+\.\d+\.\d+\.0$') { throw 'MSIX requires a stable three-part version; its fourth part is reserved by Microsoft Store.' }
    $outputRoot = [IO.Path]::GetFullPath((Join-Path $webRoot $OutputDirectory))
    $layout = Join-Path $outputRoot "layout-$Architecture-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path (Join-Path $layout 'Assets') | Out-Null
    Copy-Item -LiteralPath $BinaryPath -Destination (Join-Path $layout 'Vaelo.exe')
    foreach ($icon in @('StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png')) {
        Copy-Item -LiteralPath "src-tauri/icons/$icon" -Destination (Join-Path $layout "Assets/$icon")
    }
    [xml]$manifest = Get-Content -LiteralPath 'desktop/Package.appxmanifest' -Raw
    $manifest.Package.Identity.SetAttribute('Version', $version)
    $manifest.Package.Identity.SetAttribute('ProcessorArchitecture', $Architecture)
    $manifest.Save((Join-Path $layout 'AppxManifest.xml'))
    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $makeAppx = Get-ChildItem -LiteralPath $sdkRoot -Directory | Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64/makeappx.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $makeAppx) { throw 'Install the Windows SDK to obtain MakeAppx.exe.' }
    $package = Join-Path $outputRoot "Vaelo_${version}_${Architecture}.msix"
    & $makeAppx pack /d $layout /p $package /o
    if ($LASTEXITCODE -ne 0) { throw 'MSIX validation or packaging failed.' }
    Get-FileHash -LiteralPath $package -Algorithm SHA256 | Select-Object Path, Hash
    Write-Output 'This unsigned MSIX is for Partner Center submission. Microsoft Store signs the accepted package.'
} finally { Pop-Location }
