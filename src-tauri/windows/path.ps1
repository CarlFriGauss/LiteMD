# Used by the per-user installer only. Registry APIs avoid NSIS's PATH string limit.
param(
    [Parameter(Mandatory = $true)][ValidateSet('Add', 'Remove')][string]$Action,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [string]$EnvironmentSubKey = 'Environment',
    [string]$StateSubKey = 'Software\LiteMD\Installer'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-PathEntry([string]$Entry) {
    return [Environment]::ExpandEnvironmentVariables($Entry.Trim().Trim('"')).TrimEnd('\')
}

$installPath = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$registry = [Microsoft.Win32.Registry]::CurrentUser
$environmentKey = $registry.CreateSubKey($EnvironmentSubKey)
$stateKey = $registry.CreateSubKey($StateSubKey)
try {
    $raw = $environmentKey.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $hadPath = $null -ne $raw
    $pathText = if ($hadPath) { [string]$raw } else { '' }
    $kind = if ($hadPath) { $environmentKey.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
    $owned = [string]$stateKey.GetValue('PathEntry', '')
    $wasMissing = $stateKey.GetValue('PathWasMissing', 0) -eq 1
    [string[]]$entries = if ($pathText.Length) { $pathText.Split(';') } else { @() }

    # Remove only a previously installer-owned entry; keep all unrelated raw strings.
    if ($owned -and ($Action -eq 'Remove' -or (Normalize-PathEntry $owned) -ine $installPath)) {
        $entries = @($entries | Where-Object { (Normalize-PathEntry $_) -ine (Normalize-PathEntry $owned) })
        $stateKey.DeleteValue('PathEntry', $false)
        $stateKey.DeleteValue('PathWasMissing', $false)
        $owned = ''
    }
    if ($Action -eq 'Add') {
        $found = @($entries | Where-Object { (Normalize-PathEntry $_) -ieq $installPath }).Count -gt 0
        if (-not $found) {
            $entries += $installPath
            $stateKey.SetValue('PathEntry', $installPath, [Microsoft.Win32.RegistryValueKind]::String)
            $stateKey.SetValue('PathWasMissing', [int](-not $hadPath), [Microsoft.Win32.RegistryValueKind]::DWord)
        }
    }
    $updated = $entries -join ';'
    if ($updated -cne $pathText) {
        if ($Action -eq 'Remove' -and $wasMissing -and -not $updated.Length) {
            $environmentKey.DeleteValue('Path', $false)
        } else {
            $environmentKey.SetValue('Path', $updated, $kind)
        }
    }
} finally {
    $stateKey.Dispose()
    $environmentKey.Dispose()
}
