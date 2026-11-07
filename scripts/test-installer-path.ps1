# Real registry round trips in a unique disposable test key, never user PATH.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$testKey = 'Software\LiteMD\InstallerTests\' + [guid]::NewGuid().ToString('N')
$environmentSubKey = "$testKey\Environment"
$stateSubKey = "$testKey\State"
$registry = [Microsoft.Win32.Registry]::CurrentUser
$scriptPath = Join-Path $PSScriptRoot '..\src-tauri\windows\path.ps1'
$key = $registry.CreateSubKey($environmentSubKey)
$installDir = Join-Path ([IO.Path]::GetTempPath()) 'LiteMD test install'
function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -cne $Expected) { throw $Message }
}
function Run-Path([string]$Operation) {
    & $scriptPath -Action $Operation -InstallDir $installDir -EnvironmentSubKey $environmentSubKey -StateSubKey $stateSubKey
}
function Read-Path {
    return $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}
try {
    # Long expandable PATH, empty entries and spaces must round-trip exactly.
    $original = '%SystemRoot%\System32;;D:\' + ('long-folder;' * 900) + 'D:\with spaces'
    $key.SetValue('Path', $original, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    Run-Path Add
    $added = Read-Path
    Assert-Equal $added ($original + ';' + $installDir) 'Long PATH was truncated or rewritten'
    Run-Path Add
    Assert-Equal (Read-Path) $added 'Repeated install duplicated PATH'
    Run-Path Remove
    Assert-Equal (Read-Path) $original 'Uninstall did not restore the original PATH'
    Assert-Equal ($key.GetValueKind('Path')) ([Microsoft.Win32.RegistryValueKind]::ExpandString) 'Registry type changed'

    # A pre-existing entry belongs to the user and must survive uninstall.
    $original = 'D:\keep;"' + $installDir.ToUpperInvariant() + '\";D:\tail'
    $key.SetValue('Path', $original, [Microsoft.Win32.RegistryValueKind]::String)
    Run-Path Add
    Run-Path Remove
    Assert-Equal (Read-Path) $original 'An existing user PATH entry was removed'
    Assert-Equal ($key.GetValueKind('Path')) ([Microsoft.Win32.RegistryValueKind]::String) 'REG_SZ changed'

    # A user edit made after installing must survive uninstall.
    $key.SetValue('Path', 'D:\before')
    Run-Path Add
    $key.SetValue('Path', (Read-Path) + ';D:\added-later')
    Run-Path Remove
    Assert-Equal (Read-Path) 'D:\before;D:\added-later' 'Uninstall removed a subsequent user edit'

    $key.DeleteValue('Path')
    Run-Path Add
    Run-Path Remove
    if ($null -ne (Read-Path)) { throw 'Originally missing PATH was not restored' }
    Write-Output 'Installer PATH tests passed (long PATH, idempotence, ownership, user edits, missing value).'
} finally {
    $key.Dispose()
    $registry.DeleteSubKeyTree($testKey, $false)
}
