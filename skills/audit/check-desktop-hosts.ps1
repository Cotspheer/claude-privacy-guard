# Shows which hosts the Claude desktop app contacts, by starting it once behind the logging proxy of
# check-hosts.mjs. Run it yourself in a PowerShell window, not from inside a Claude session: the app is closed
# and started again on the way, and sessions it hosts end with it.
#
#   .\check-desktop-hosts.ps1               five minutes
#   .\check-desktop-hosts.ps1 -Minutes 10
#   .\check-desktop-hosts.ps1 -DryRun       only say what would happen
#
# What it sees: the app's own traffic, by host name and size, never content. Claude Code sessions the app
# starts may connect past the proxy; check-hosts.mjs cli covers Claude Code.
param([int]$Minutes = 5, [int]$Port = 58555, [switch]$DryRun)

$package = Get-AppxPackage -Name '*Claude*' -ErrorAction SilentlyContinue | Select-Object -First 1
$candidates = @()
if ($package) { $candidates += Join-Path $package.InstallLocation 'app\Claude.exe' }
$candidates += Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe'
$exe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $exe) { 'The Claude desktop app was not found on this computer.'; exit 1 }

$report = Join-Path $env:TEMP 'claude-desktop-hosts.txt'
$listener = Join-Path $PSScriptRoot 'check-hosts.mjs'
$proxy = "http://127.0.0.1:$Port"
$running = { @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) }

"App:      $exe"
"Proxy:    $proxy for $Minutes minute(s)"
"Report:   $report"
if ($DryRun) { "Dry run: nothing was closed or started. App processes running now: $((& $running).Count)"; exit 0 }

''
'Step 1 of 4. Quit the Claude app now: right-click its icon near the clock and choose Quit. Open sessions end.'
while ((& $running).Count -gt 0) { Start-Sleep -Seconds 2 }
'The app is closed.'

'Step 2 of 4. Starting the logging proxy and the app behind it ...'
if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Confirm:$false }
Start-Process -FilePath 'node' -ArgumentList @("`"$listener`"", 'listen', '--minutes', $Minutes, '--port', $Port, '--out', "`"$report`"") -WindowStyle Minimized
Start-Sleep -Seconds 2
# The flag routes the app's own traffic; the variables are for the programs it starts.
$env:HTTPS_PROXY = $proxy
$env:HTTP_PROXY = $proxy
try {
    Start-Process -FilePath $exe -ArgumentList "--proxy-server=$proxy"
} catch {
    "The app could not be started with a proxy option: $($_.Exception.Message)"
    'Start the app the usual way. This check cannot route it; see the install guide for the system proxy route.'
    exit 1
}

"Step 3 of 4. Use the app for $Minutes minute(s): open a chat, send a message, open a Code session. This window waits."
Start-Sleep -Seconds ($Minutes * 60 + 5)

'Step 4 of 4. The result:'
''
if (Test-Path -LiteralPath $report) { Get-Content -LiteralPath $report } else { 'No report was written. The proxy did not run to its end.' }
''
'The proxy has stopped, and the app still points at it. Quit the app once more and start it the usual way.'
"The report stays at $report. Your Claude can read it for you."
