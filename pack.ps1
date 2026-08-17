$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'
$out = Join-Path $root 'release'
$stage = Join-Path $out 'dsh-portable-win64'
$version = '0.1.0'

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'tools') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'plugins') | Out-Null

Write-Host 'Copying launcher + setup + tray...'
Copy-Item -LiteralPath (Join-Path $dist 'dsh-web.exe') -Destination $stage
Copy-Item -LiteralPath (Join-Path $dist 'setup.cmd') -Destination $stage
Copy-Item -LiteralPath (Join-Path $dist 'setup.ps1') -Destination $stage
Copy-Item -LiteralPath (Join-Path $dist 'tools') -Destination (Join-Path $stage 'tools') -Recurse

Write-Host 'Copying runtime (dsh package only, no user data)...'
Copy-Item -LiteralPath (Join-Path $dist 'runtime\package.json') -Destination (Join-Path $stage 'runtime')
Copy-Item -LiteralPath (Join-Path $dist 'runtime\node_modules') -Destination (Join-Path $stage 'runtime\node_modules') -Recurse

Write-Host 'Writing neutral launcher.json...'
$neutral = @(
  '{',
  '  "openBrowser": true,',
  '  "openMode": "app",',
  '  "update": true',
  '}'
)
Set-Content -LiteralPath (Join-Path $stage 'launcher.json') -Value $neutral -Encoding UTF8

Write-Host 'Bundling Codex sync plugin...'
Copy-Item -LiteralPath (Join-Path $root 'plugins\dsh-codex-sync') -Destination (Join-Path $stage 'plugins\dsh-codex-sync') -Recurse

Write-Host 'Writing first-run guide...'
Copy-Item -LiteralPath (Join-Path $root 'launcher\pack-assets\README.txt') -Destination (Join-Path $stage 'README.txt')

Write-Host 'Adding usage webpage...'
Copy-Item -LiteralPath (Join-Path $root 'docs\usage.html') -Destination (Join-Path $stage 'usage.html')
Copy-Item -LiteralPath (Join-Path $root 'docs\usage.md') -Destination (Join-Path $stage 'usage.md')

$zip = Join-Path $out ("deepseek-harness-portable-win64-" + $version + ".zip")
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Write-Host 'Compressing (this can take a minute)...'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

$sizeMb = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
Write-Host ''
Write-Host "Package ready: $zip ($sizeMb MB)"
Write-Host "Staging folder: $stage"
