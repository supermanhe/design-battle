$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
node (Join-Path $Repo "bin\design-battle.mjs") doctor
