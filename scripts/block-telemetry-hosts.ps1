# Blocks the hosts that receive nothing but telemetry from Claude Code and the Claude desktop app, by pointing
# them nowhere in the hosts file. Sign-in, the model API, Remote Control and auto-updates use other hosts.
# The hosts and what each one carries are listed in telemetry-hosts.txt next to this script.
#
#   .\block-telemetry-hosts.ps1              block the default hosts
#   .\block-telemetry-hosts.ps1 -Extended    also block the analytics hosts of the claude.ai pages
#   .\block-telemetry-hosts.ps1 -Remove      take all entries out again
#
# The system's hosts file needs administrator rights. Started without them, the script asks Windows for them
# and you confirm the Windows prompt.
param(
    [switch]$Extended,
    [switch]$Remove,
    [string]$HostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
)

$systemFile = $HostsFile -like "$env:SystemRoot*"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($systemFile -and -not $isAdmin) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Extended) { $arguments += '-Extended' }
    if ($Remove) { $arguments += '-Remove' }
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait
    return
}

# The hosts of the wanted sections of telemetry-hosts.txt.
$wanted = @('default')
if ($Extended) { $wanted += 'extended' }
$section = ''
$names = foreach ($line in Get-Content -LiteralPath (Join-Path $PSScriptRoot 'telemetry-hosts.txt')) {
    $text = ($line -replace '#.*$', '').Trim()
    if ($text -match '^\[(.+)\]$') { $section = $Matches[1]; continue }
    if ($text -and $wanted -contains $section) { $text }
}

$marker = '# claude-privacy-guard'
$lines = @(Get-Content -LiteralPath $HostsFile | Where-Object { $_ -notlike "*$marker*" })
if (-not $Remove) {
    # Both address families, so that a lookup over IPv6 does not get past the entry.
    $lines += $names | ForEach-Object { "0.0.0.0 $_ $marker"; ":: $_ $marker" }
}
Set-Content -LiteralPath $HostsFile -Value $lines -Encoding ascii

if ($systemFile) { ipconfig /flushdns | Out-Null }
if ($Remove) { 'Removed the entries.' } else { "Blocked $(@($names).Count) hosts: $($names -join ', ')" }
