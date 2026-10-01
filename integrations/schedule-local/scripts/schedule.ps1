param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
$skillDirectory = Split-Path -Parent $PSScriptRoot
$configuration = Get-Content -LiteralPath (Join-Path $skillDirectory 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$cli = [string]$configuration.cli
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'Schedule CLI is missing. Reinstall this integration with the current application directory.' }
$requestPath = (Resolve-Path -LiteralPath $RequestFile).Path
& $cli --request $requestPath
exit $LASTEXITCODE
