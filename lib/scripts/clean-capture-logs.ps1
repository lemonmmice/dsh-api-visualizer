# clean-capture-logs.ps1 — log cleanup helper for dsh-api-visualizer.
# Called by the plugin's POST /logs/clear route; also usable standalone.
#
# Deletes the client System.Net trace log (Windows file locking protects an
# in-use trace: while the client still writes it, deletion silently fails and
# the caller reports the file as skipped) and *.log files under the capture
# store directory. The record store (records.jsonl) is panel data, not logs,
# and is only removed when -CleanStore is passed explicitly.
param(
  [string]$TraceLog = '',
  [string]$LogDir = '',
  [switch]$CleanStore
)
$ErrorActionPreference = 'SilentlyContinue'

# 1) client System.Net trace log (largest file, contains real tokens)
if ($TraceLog -eq '') { $TraceLog = Join-Path $env:TEMP 'uiprobe-net-trace.log' }
Remove-Item -LiteralPath $TraceLog -Force

# 2) runtime/test logs under the capture store directory
if ($LogDir -ne '') {
  Get-ChildItem -LiteralPath $LogDir -Filter '*.log' -File |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

# 3) optional: clear the record store
if ($CleanStore -and $LogDir -ne '') {
  Remove-Item -LiteralPath (Join-Path $LogDir 'records.jsonl') -Force
}
