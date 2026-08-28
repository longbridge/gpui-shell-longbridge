param(
    [string]$Binary = "target\release\longbridge-lite.exe",
    [string]$ReuseArchive = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $RepoRoot "dist"
$Stage = Join-Path $Dist ".package-windows-x86_64"
$Package = Join-Path $Stage "longbridge-lite"
$Archive = Join-Path $Dist "longbridge-lite-windows-x86_64.zip"
$BinaryPath = Join-Path $RepoRoot $Binary

New-Item -ItemType Directory -Force $Dist | Out-Null
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue

if ($ReuseArchive) {
    $ReuseArchivePath = if ([System.IO.Path]::IsPathRooted($ReuseArchive)) {
        $ReuseArchive
    } else {
        Join-Path $RepoRoot $ReuseArchive
    }
    if (-not (Test-Path $ReuseArchivePath -PathType Leaf)) {
        throw "reuse archive is missing: $ReuseArchivePath"
    }
    Expand-Archive $ReuseArchivePath -DestinationPath $Stage
    if (-not (Test-Path (Join-Path $Package "bin\longbridge-lite.exe") -PathType Leaf)) {
        throw "reuse archive has no Windows host"
    }
    Remove-Item -Recurse -Force (Join-Path $Package "app") -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force (Join-Path $Package "app") | Out-Null
    Copy-Item -Recurse (Join-Path $RepoRoot "app\*") (Join-Path $Package "app")
    Remove-Item -Force $Archive -ErrorAction SilentlyContinue
    Compress-Archive -Path $Package -DestinationPath $Archive -CompressionLevel Optimal
    Write-Output $Archive
    exit 0
}

if (-not (Test-Path $BinaryPath -PathType Leaf)) {
    throw "release binary is missing: $BinaryPath"
}
if (-not (Get-Command magick -ErrorAction SilentlyContinue)) {
    throw "ImageMagick (magick) is required"
}

New-Item -ItemType Directory -Force (Join-Path $Package "bin"), (Join-Path $Package "app") | Out-Null
Copy-Item $BinaryPath (Join-Path $Package "bin\longbridge-lite.exe")
Copy-Item -Recurse (Join-Path $RepoRoot "app\*") (Join-Path $Package "app")
& magick -background none (Join-Path $RepoRoot "assets\app-icon.svg") `
    -define "icon:auto-resize=256,128,64,48,32,16" (Join-Path $Package "app-icon.ico")
if ($LASTEXITCODE -ne 0) { throw "failed to generate app-icon.ico" }

Remove-Item -Force $Archive -ErrorAction SilentlyContinue
Compress-Archive -Path $Package -DestinationPath $Archive -CompressionLevel Optimal
Write-Output $Archive
