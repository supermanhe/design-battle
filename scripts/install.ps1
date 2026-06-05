param(
  [ValidateSet("Auto", "Link", "Copy")]
  [string]$Mode = "Auto",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$HomeDir = if ($env:DESIGN_BATTLE_INSTALL_HOME) { $env:DESIGN_BATTLE_INSTALL_HOME } else { [Environment]::GetFolderPath("UserProfile") }
if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 18+ is required before installing Design Battle."
}
$NodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 18) {
  throw "Node.js 18+ is required before installing Design Battle."
}
$Hosts = @(
  @{ Name = "Codex"; Command = "codex"; Root = Join-Path $HomeDir ".codex\skills" },
  @{ Name = "Claude Code"; Command = "claude"; Root = Join-Path $HomeDir ".claude\skills" },
  @{ Name = "Hermes"; Command = "hermes"; Root = Join-Path $HomeDir ".hermes\skills" },
  @{ Name = "OpenClaw"; Command = "openclaw"; Root = Join-Path $HomeDir ".openclaw\skills" }
)

function Install-Skill([string]$Root, [string]$Name) {
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  $Target = Join-Path $Root "design-battle"
  if (Test-Path $Target) {
    if (-not $Force) {
      Write-Host "$Name`: already installed at $Target"
      return
    }
    $Resolved = (Resolve-Path $Target).Path
    if (-not $Resolved.StartsWith((Resolve-Path $Root).Path, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to replace path outside $Root"
    }
    Remove-Item -LiteralPath $Target -Recurse -Force
  }
  if ($Mode -ne "Copy") {
    try {
      New-Item -ItemType Junction -Path $Target -Target $Repo -ErrorAction Stop | Out-Null
      Write-Host "$Name`: linked $Target"
      return
    } catch {
      if ($Mode -eq "Link") { throw }
    }
  }
  Copy-Item -Path $Repo -Destination $Target -Recurse
  Write-Host "$Name`: copied $Target"
}

foreach ($HostInfo in $Hosts) {
  $Available = $null -ne (Get-Command $HostInfo.Command -ErrorAction SilentlyContinue)
  if ($Available -or (Test-Path $HostInfo.Root)) {
    Install-Skill $HostInfo.Root $HostInfo.Name
  } else {
    Write-Host "$($HostInfo.Name): unavailable, skipped"
  }
}

$Shared = Join-Path $HomeDir ".agents\skills"
Install-Skill $Shared "Shared Agent Skills"
node (Join-Path $Repo "bin\design-battle.mjs") doctor
