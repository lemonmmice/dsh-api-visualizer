# install.ps1 — install the lemonmmice dsh community plugins into a dsh web profile.
# Installs BOTH dsh-api-visualizer (API capture) and dsh-postman (API debug) from GitHub,
# registers them in the profile's cordis.patch.yml (idempotent), and prints the restart hint.
#
# Usage (PowerShell 5+):
#   powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/lemonmmice/dsh-api-visualizer/main/scripts/install.ps1 | iex"
#
# Optional parameters:
#   -ProfileDir <path>   profile root (default: ~\.dsh\profiles\web)
#   -Plugins a,b         subset of plugins to install (default: both)
param(
  [string]$ProfileDir = '',
  [string[]]$Plugins = @('dsh-api-visualizer', 'dsh-postman')
)
$ErrorActionPreference = 'Stop'

$entries = @{
  'dsh-api-visualizer' = @{ Id = 'api-visualizer'; Name = '@linxin666/dsh-api-visualizer' }
  'dsh-postman'        = @{ Id = 'postman';        Name = '@linxin666/dsh-postman' }
}

if ($ProfileDir -eq '') { $ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\web' }
if (-not (Test-Path $ProfileDir)) { throw "dsh profile directory not found: $ProfileDir (install dsh first, or pass -ProfileDir)" }

$patchFile = Join-Path $ProfileDir 'cordis.patch.yml'
$patchText = if (Test-Path $patchFile) { Get-Content $patchFile -Raw } else { '' }
$registered = @()

foreach ($plugin in $Plugins) {
  if (-not $entries.ContainsKey($plugin)) { Write-Warning "unknown plugin '$plugin' skipped"; continue }
  $dest = Join-Path $ProfileDir "node_modules\@linxin666\$plugin"
  Write-Host "==> $plugin : downloading from github.com/lemonmmice/$plugin"
  $zip = Join-Path $env:TEMP "$plugin.zip"
  $tmp = Join-Path $env:TEMP "$plugin-extract"
  Invoke-WebRequest -Uri "https://codeload.github.com/lemonmmice/$plugin/zip/refs/heads/main" -OutFile $zip -UseBasicParsing
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
  # Copy instead of Move: right after Expand-Archive the extracted tree can still
  # be transiently locked (AV / zip stream), which makes Move-Item flaky.
  Copy-Item -Path (Join-Path $tmp "$plugin-main") -Destination $dest -Recurse -Force
  Remove-Item $zip -Force
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "    installed to $dest"

  if ($patchText -notmatch [regex]::Escape("id: $($entries[$plugin].Id)")) {
    $patchText = $patchText.TrimEnd() + "`n`n- insert:`n    - id: $($entries[$plugin].Id)`n      name: '$($entries[$plugin].Name)'`n"
    $registered += $plugin
    Write-Host "    registered in cordis.patch.yml"
  } else {
    Write-Host "    already registered"
  }
}

if ($registered.Count -gt 0) {
  [System.IO.File]::WriteAllText($patchFile, $patchText, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ''
Write-Host 'Done. Restart the dsh web host (dsh web / your launcher), then refresh the page.'
Write-Host 'Sidebar entries: api-visualizer (API capture) and postman (API debug).'
