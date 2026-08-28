param(
    [string]$Version = "latest",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$Repository = "longbridge/longbridge-lite"
$InstallRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "longbridge-lite"
$BinDir = Join-Path $InstallRoot "bin"
$Executable = Join-Path $BinDir "longbridge-lite.exe"
$StartMenu = Join-Path ([Environment]::GetFolderPath('StartMenu')) "Programs"
$Shortcut = Join-Path $StartMenu "Longbridge Lite.lnk"

function Remove-UserPathEntry([string]$Entry) {
    $current = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
    if (-not $current) { return }
    $parts = @($current.Split(';') | Where-Object { $_ -and $_ -ne $Entry })
    [Environment]::SetEnvironmentVariable("Path", ($parts -join ';'), [EnvironmentVariableTarget]::User)
}

if ($Uninstall) {
    Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue
    Remove-Item -Force $Shortcut -ErrorAction SilentlyContinue
    Remove-UserPathEntry $BinDir
    Write-Output "Longbridge Lite removed; user data was preserved."
    exit 0
}

if (-not [Environment]::Is64BitOperatingSystem) {
    throw "Longbridge Lite supports only x86_64 Windows."
}

$Temp = Join-Path ([IO.Path]::GetTempPath()) ("longbridge-lite-install-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Force $Temp | Out-Null
try {
    $Asset = "longbridge-lite-windows-x86_64.zip"
    $BundleOverride = $env:LONGBRIDGE_LITE_BUNDLE_PATH
    if ($BundleOverride) {
        $Archive = (Resolve-Path $BundleOverride).Path
    } else {
        $Tag = if ($Version -eq "latest") { "latest" } else { "v" + $Version.TrimStart('v') }
        $Base = if ($Tag -eq "latest") {
            "https://github.com/$Repository/releases/latest/download"
        } else {
            "https://github.com/$Repository/releases/download/$Tag"
        }
        $Archive = Join-Path $Temp $Asset
        $Sums = Join-Path $Temp "SHA256SUMS"
        Invoke-WebRequest -UseBasicParsing "$Base/$Asset" -OutFile $Archive
        Invoke-WebRequest -UseBasicParsing "$Base/SHA256SUMS" -OutFile $Sums
        $Line = Get-Content $Sums | Where-Object { $_ -match "\s\*?$([regex]::Escape($Asset))$" } | Select-Object -First 1
        if (-not $Line) { throw "SHA256SUMS has no entry for $Asset" }
        $Expected = ($Line -split '\s+')[0].ToLowerInvariant()
        $Actual = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
        if ($Actual -ne $Expected) { throw "checksum mismatch for $Asset" }
    }

    $Extracted = Join-Path $Temp "extracted"
    Expand-Archive -Path $Archive -DestinationPath $Extracted
    $Source = Join-Path $Extracted "longbridge-lite"
    if (-not (Test-Path $Source -PathType Container)) { throw "release archive has an unexpected layout" }

    $Backup = "$InstallRoot.previous"
    Remove-Item -Recurse -Force $Backup -ErrorAction SilentlyContinue
    if (Test-Path $InstallRoot) { Move-Item $InstallRoot $Backup }
    try {
        Move-Item $Source $InstallRoot
        Remove-Item -Recurse -Force $Backup -ErrorAction SilentlyContinue
    } catch {
        Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue
        if (Test-Path $Backup) { Move-Item $Backup $InstallRoot }
        throw
    }

    $CurrentPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
    $PathParts = if ($CurrentPath) { @($CurrentPath.Split(';') | Where-Object { $_ }) } else { @() }
    if ($PathParts -notcontains $BinDir) {
        $NewPath = (@($PathParts) + $BinDir) -join ';'
        [Environment]::SetEnvironmentVariable("Path", $NewPath, [EnvironmentVariableTarget]::User)
    }

    New-Item -ItemType Directory -Force $StartMenu | Out-Null
    $Shell = New-Object -ComObject WScript.Shell
    $Link = $Shell.CreateShortcut($Shortcut)
    $Link.TargetPath = $Executable
    $Link.WorkingDirectory = $InstallRoot
    $Link.IconLocation = (Join-Path $InstallRoot "app-icon.ico")
    $Link.Save()
    Write-Output "Longbridge Lite installed at $InstallRoot"
} finally {
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}
