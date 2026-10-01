param(
  [Parameter(Mandatory=$true)][string]$AppDirectory,
  [ValidateSet('Codex','Claude','Both')][string]$Target='Both',
  [string]$CodexDirectory = $(if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $env:USERPROFILE '.codex'}),
  [string]$ClaudeDirectory = $(if($env:CLAUDE_CONFIG_DIR){$env:CLAUDE_CONFIG_DIR}else{Join-Path $env:USERPROFILE '.claude'}),
  [switch]$Force
)
$ErrorActionPreference='Stop'
$application=(Resolve-Path -LiteralPath $AppDirectory).Path
$cli=Join-Path $application 'Schedule.Cli.exe'
if(-not(Test-Path -LiteralPath $cli -PathType Leaf)){throw 'Build or install Schedule before installing its skill.'}
$source=Join-Path $application 'integrations/schedule-local'
if(-not(Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))){throw 'The installed integration template is missing.'}
$destinations=@()
if($Target -eq 'Codex' -or $Target -eq 'Both'){$destinations+=Join-Path $CodexDirectory 'skills/schedule-local'}
if($Target -eq 'Claude' -or $Target -eq 'Both'){$destinations+=Join-Path $ClaudeDirectory 'skills/schedule-local'}
foreach($destination in $destinations){
  if((Test-Path -LiteralPath $destination) -and -not $Force){throw "Skill already exists: $destination. Inspect it before using -Force."}
}
foreach($destination in $destinations){
  if(Test-Path -LiteralPath $destination){
    Copy-Item -LiteralPath $destination -Destination ($destination+'.backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')) -Recurse
  }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
  @{cli=$cli}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $destination 'config.json') -Encoding UTF8
  Write-Output "Installed: $destination"
}
