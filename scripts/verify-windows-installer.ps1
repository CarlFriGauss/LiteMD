# Run only on a clean disposable Windows runner.
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [string]$PortableExe = (Join-Path $PSScriptRoot '..\target\release\litemd.exe'),
    [string]$DataDir = (Join-Path $env:LOCALAPPDATA 'com.litemd.editor\.cache')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LiteMD') {
    throw 'Installer smoke test requires a clean runner without LiteMD installed.'
}
$installDir = Join-Path ([IO.Path]::GetTempPath()) ('LiteMD-smoke-' + [guid]::NewGuid().ToString('N'))
$originalPath = [Environment]::GetEnvironmentVariable('Path', 'User')
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$sentinel = Join-Path $dataDir 'installer-smoke-preserve.txt'
[IO.File]::WriteAllText($sentinel, 'preserve user data')
$process = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installDir" -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$exe = Join-Path $installDir 'litemd.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed executable missing' }
if ((Get-FileHash $exe).Hash -ne (Get-FileHash $PortableExe).Hash) { throw 'Installer and portable executable differ' }
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($installDir -notin $userPath.Split(';')) { throw 'Installer did not add PATH' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'LiteMD.lnk'
if (-not (Test-Path -LiteralPath $shortcut)) { throw 'Start menu shortcut missing' }
if ($shell.CreateShortcut($shortcut).TargetPath -ine $exe) { throw 'Start menu shortcut target incorrect' }
$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'LiteMD.lnk'
if (-not (Test-Path -LiteralPath $desktop)) { throw 'Desktop shortcut missing in silent setup' }
if ($shell.CreateShortcut($desktop).TargetPath -ine $exe) { throw 'Desktop shortcut target incorrect' }
$process = Start-Process -FilePath (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
for ($i = 0; $i -lt 40 -and (Test-Path -LiteralPath $exe); $i++) { Start-Sleep -Milliseconds 250 }
if (Test-Path -LiteralPath $exe) { throw 'Uninstaller left the executable' }
if ([Environment]::GetEnvironmentVariable('Path', 'User') -cne $originalPath) { throw 'Uninstaller changed unrelated PATH entries' }
if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstaller removed user data without consent' }
Remove-Item -LiteralPath $sentinel
Write-Output 'Installer smoke test passed: install, Start menu, PATH, uninstall, user-data preservation.'
