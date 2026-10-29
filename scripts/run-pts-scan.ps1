param(
  [ValidateSet("v1", "v2", "all")]
  [string]$Mode = "all",
  [switch]$Publish,
  [string]$NodePath = ""
)
$ErrorActionPreference = "Stop"
if (-not $NodePath) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Node.js was not found. Install Node 18+ or pass -NodePath C:\path\to\node.exe." }
  $NodePath = $cmd.Source
}
$args = @((Join-Path $PSScriptRoot "run-pts-scan.mjs"), "--mode=$Mode")
if ($Publish) { $args += "--publish" }
& $NodePath @args
