# LiteMD — Strict D:\ Drive Build & Runtime Environment Script (AGENT.md Section 0.1)
# Ensures 100% of Cargo crates, target artifacts, npm caches, and temp files stay on D:\.

$env:CARGO_HOME = "D:\projects\TextEditor\.cache\cargo"
$env:CARGO_TARGET_DIR = "D:\projects\TextEditor\target"
$env:NPM_CONFIG_CACHE = "D:\projects\TextEditor\.cache\npm"
$env:TEMP = "D:\projects\TextEditor\.cache\tmp"
$env:TMP = "D:\projects\TextEditor\.cache\tmp"
$env:WEBVIEW2_USER_DATA_FOLDER = "D:\projects\TextEditor\.cache\webview2"

$toolchainDirs = @(
    "D:\projects\TextEditor\.cache\winlibs",
    "D:\rtools44\x86_64-w64-mingw32.static.posix\bin",
    "C:\Users\Rachailovich\.rustup\toolchains\stable-x86_64-pc-windows-msvc\lib\rustlib\x86_64-pc-windows-msvc\bin",
    "C:\Users\Rachailovich\.cargo\bin"
)
foreach ($dir in $toolchainDirs) {
    if ((Test-Path $dir) -and ($env:PATH -notlike "*$dir*")) {
        $env:PATH = "$dir;$env:PATH"
    }
}

New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, $env:CARGO_TARGET_DIR, $env:NPM_CONFIG_CACHE, $env:TEMP, "D:\projects\TextEditor\themes" | Out-Null
Write-Host "[LiteMD] D:\ storage & toolchain environment active:" -ForegroundColor Cyan
Write-Host "  CARGO_HOME       = $env:CARGO_HOME"
Write-Host "  CARGO_TARGET_DIR = $env:CARGO_TARGET_DIR"
Write-Host "  NPM_CONFIG_CACHE = $env:NPM_CONFIG_CACHE"
Write-Host "  TEMP / TMP       = $env:TEMP"
