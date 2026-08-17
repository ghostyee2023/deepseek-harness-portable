$ErrorActionPreference = 'Stop'

$DistDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $DistDir 'dsh-web.exe'
$TrayExe = Join-Path $DistDir 'tools\dsh-tray.exe'
$StartupName = 'DeepSeek Harness'

function New-Shortcut {
  param([string]$Target, [string]$Arguments, [string]$Name, [string]$Folder)
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $Folder ($Name + '.lnk')))
  $lnk.TargetPath = $Target
  if ($Arguments) { $lnk.Arguments = $Arguments }
  $lnk.WorkingDirectory = $DistDir
  $lnk.Save()
}

function Install-DesktopShortcut {
  $desktop = [Environment]::GetFolderPath('Desktop')
  New-Shortcut -Target $Launcher -Name $StartupName -Folder $desktop
  Write-Host '  [OK] Desktop shortcut created.'
}

function Install-AutoStart {
  if (-not (Test-Path $TrayExe)) { Write-Host '  [!!] tools\dsh-tray.exe not found. Run launcher\build.ps1 first.'; return }
  $startup = [Environment]::GetFolderPath('Startup')
  New-Shortcut -Target $TrayExe -Name $StartupName -Folder $startup
  Write-Host '  [OK] Auto-start enabled (tray runs on login).'
}

function Remove-AutoStart {
  $startup = [Environment]::GetFolderPath('Startup')
  $lnk = Join-Path $startup ($StartupName + '.lnk')
  if (Test-Path $lnk) {
    Remove-Item -LiteralPath $lnk -Force
    Write-Host '  [OK] Auto-start removed.'
  } else {
    Write-Host '  [..] No auto-start shortcut found.'
  }
}

function Start-TrayNow {
  if (-not (Test-Path $TrayExe)) { Write-Host '  [!!] tools\dsh-tray.exe not found.'; return }
  Start-Process -FilePath $TrayExe -WorkingDirectory $DistDir
  Write-Host '  [OK] Tray started.'
}

function Stop-All {
  Get-Process -Name 'dsh-web' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$DistDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host '  [OK] DSH services stopped.'
}

function Install-CodexPlugin {
  $home = Join-Path $DistDir 'runtime\dsh-home'
  $patch = Join-Path $home 'profiles\web\cordis.patch.yml'
  if (-not (Test-Path $patch)) {
    Write-Host '  [!!] Please run dsh-web.exe once first (initializes the profile), then retry.'
    return
  }
  $plugin = Join-Path $DistDir 'plugins\dsh-codex-sync'
  if (-not (Test-Path $plugin)) {
    Write-Host '  [!!] plugins\dsh-codex-sync not found in this package.'
    return
  }
  $bin = Join-Path $DistDir 'runtime\node_modules\@deepseek-ai\dsh\lib\bin.js'
  $env:DSH_HOME = $home
  & node $bin plugin --profile web add ("file:" + $plugin) | Out-Host
  $content = Get-Content -LiteralPath $patch -Raw
  if ($content -notmatch 'codex-sync') {
    $insert = @'

- insert:
    - id: codex-sync
      name: 'dsh-codex-sync'
      config:
        defaultCount: 10
'@
    Add-Content -LiteralPath $patch -Value $insert
  }
  Write-Host '  [OK] Codex sync plugin installed. Restart dsh-web.exe to activate.'
}
function Show-Menu {
  Clear-Host
  Write-Host ''
  Write-Host '  DeepSeek Harness - optional setup'
  Write-Host '  ==================================='
  Write-Host ''
  Write-Host '    1. Create desktop shortcut'
  Write-Host '    2. Enable auto-start (tray on login)'
  Write-Host '    3. Disable auto-start'
  Write-Host '    4. Start tray now'
  Write-Host '    5. Stop all DSH services'
  Write-Host '    6. Install Codex sync plugin (run dsh-web.exe once first)'
  Write-Host '    0. Exit'
  Write-Host ''
}

if ($args.Count -gt 0) {
  switch ($args[0]) {
    'desktop'  { Install-DesktopShortcut }
    'autostart' { Install-AutoStart }
    'no-autostart' { Remove-AutoStart }
    'tray'     { Start-TrayNow }
    'stop'     { Stop-All }
    'codex-plugin' { Install-CodexPlugin }
    default    { Write-Host "Unknown action: $($args[0])" }
  }
  exit
}

while ($true) {
  Show-Menu
  $choice = Read-Host '  Choose an option'
  switch ($choice) {
    '1' { Install-DesktopShortcut }
    '2' { Install-AutoStart }
    '3' { Remove-AutoStart }
    '4' { Start-TrayNow }
    '5' { Stop-All }
    '6' { Install-CodexPlugin }
    '0' { Write-Host '  Bye.'; exit }
    default { Write-Host '  Invalid option.' }
  }
  Write-Host ''
  Read-Host '  Press Enter to continue'
}
