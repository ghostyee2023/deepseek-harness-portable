# Restart the portable DSH web server to pick up newly imported sessions.
# Runs detached, delayed, so the current agent turn can finish first.
$ErrorActionPreference = 'SilentlyContinue'
$log = 'D:\work\opc-deepseek-harness\restart_dsh.log'
$workdir = 'D:\work\opc-deepseek-harness'
$exe = 'D:\work\opc-deepseek-harness\dist\dsh-web.exe'

function Log($msg) {
  Add-Content -Path $log -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] " + $msg)
}

Log "restart script started, waiting 45s for current turn to finish"
Start-Sleep -Seconds 45

# Kill the old server (anything listening on 3080)
$conns = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
$killed = @()
foreach ($c in $conns) {
  $procId = $c.OwningProcess
  if ($procId -and ($procId -notin $killed)) {
    $killed += $procId
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Log "killed PID $procId"
  }
}
if ($killed.Count -eq 0) { Log "no listener on 3080 found" }

Start-Sleep -Seconds 3

# Start the new server detached via the portable launcher (no browser).
Log "starting: dsh-web.exe --no-open"
Start-Process -FilePath $exe `
  -ArgumentList '--no-open' `
  -WorkingDirectory $workdir `
  -WindowStyle Hidden

Log "start command issued"
Start-Sleep -Seconds 8

# Verify
$alive = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($alive) { Log "OK: port 3080 is listening again (PID $($alive[0].OwningProcess))" }
else { Log "WARN: port 3080 not listening yet" }
