$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$nodeExe = (Get-Command node).Source
if (-not $nodeExe) { throw "node not found on PATH" }
Write-Host "Node runtime: $nodeExe"

node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw "sea-config failed" }

$dist = Join-Path $PSScriptRoot "..\dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$outExe = Join-Path $dist "dsh-web.exe"

Copy-Item -LiteralPath $nodeExe -Destination $outExe -Force

npx --yes postject $outExe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "postject failed" }

# Optional setup menu + tray helper (Windows only)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "setup\setup.cmd") -Destination $dist -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "setup\setup.ps1") -Destination $dist -Force
$tools = Join-Path $dist "tools"
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (Test-Path $csc) {
  $outTray = Join-Path $tools "dsh-tray.exe"
  $srcTray = Join-Path $PSScriptRoot "setup\dsh-tray.cs"
  & $csc /nologo /target:winexe ("/out:" + $outTray) `
    "/r:System.Windows.Forms.dll" "/r:System.Drawing.dll" "/r:System.Management.dll" $srcTray
  if ($LASTEXITCODE -ne 0) { Write-Host "WARN: tray build failed" }
  else { Write-Host "Tray helper built: $(Join-Path $tools 'dsh-tray.exe')" }
} else {
  Write-Host "WARN: csc not found, skipping tray helper"
}

Write-Host ""
Write-Host "Built: $outExe"
Write-Host "Portable layout: $outExe + setup.cmd + launcher.json + runtime\ + tools\ (tray)."
