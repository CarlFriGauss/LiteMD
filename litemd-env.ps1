# LiteMD — Portable Build & Runtime Environment Script (AGENT.md Section 0.1)
# Keeps Cargo crates, target artifacts, npm caches, and temp files inside the project directory.

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

$env:CARGO_HOME = Join-Path $rootDir ".cache\cargo"
$env:CARGO_TARGET_DIR = Join-Path $rootDir "target"
if (-not $env:CARGO_BUILD_JOBS) {
    $env:CARGO_BUILD_JOBS = "1"
}
$env:NPM_CONFIG_CACHE = Join-Path $rootDir ".cache\npm"
$env:TEMP = Join-Path $rootDir ".cache\tmp"
$env:TMP = Join-Path $rootDir ".cache\tmp"
# The application chooses its profile from LITEMD_DATA_DIR (or the D: workspace).
# Do not force a second profile when launching a development build after installing.

$winlibsDir = Join-Path $rootDir ".cache\winlibs"
if (Test-Path $winlibsDir) {
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = "rust-lld.exe"
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = "-L native=$winlibsDir"
    $env:AR = Join-Path $winlibsDir "lib.exe"
    $env:RC = Join-Path $winlibsDir "rc.exe"
}

if (Test-Path "D:\rtools44\x86_64-w64-mingw32.static.posix\bin\gcc.exe") {
    $env:CC = "D:\rtools44\x86_64-w64-mingw32.static.posix\bin\gcc.exe"
    $env:CXX = "D:\rtools44\x86_64-w64-mingw32.static.posix\bin\g++.exe"
}

$toolchainDirs = @(
    $winlibsDir,
    "D:\rtools44\x86_64-w64-mingw32.static.posix\bin",
    (Join-Path $env:USERPROFILE ".rustup\toolchains\stable-x86_64-pc-windows-msvc\lib\rustlib\x86_64-pc-windows-msvc\bin"),
    (Join-Path $env:USERPROFILE ".cargo\bin")
)
foreach ($dir in $toolchainDirs) {
    if ($dir -and (Test-Path $dir) -and ($env:PATH -notlike "*$dir*")) {
        $env:PATH = "$dir;$env:PATH"
    }
}

New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, $env:CARGO_TARGET_DIR, $env:NPM_CONFIG_CACHE, $env:TEMP, (Join-Path $rootDir "themes") | Out-Null
Write-Host "[LiteMD] Build & storage environment active:" -ForegroundColor Cyan
Write-Host "  CARGO_HOME       = $env:CARGO_HOME"
Write-Host "  CARGO_TARGET_DIR = $env:CARGO_TARGET_DIR"
Write-Host "  NPM_CONFIG_CACHE = $env:NPM_CONFIG_CACHE"
Write-Host "  TEMP / TMP       = $env:TEMP"
