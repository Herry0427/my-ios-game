#Requires -Version 5.0
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { $Host.UI.RawUI.OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

function Refresh-EnvPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
    foreach ($base in @("$env:ProgramFiles\nodejs", "${env:ProgramFiles(x86)}\nodejs")) {
        if (Test-Path -LiteralPath $base) {
            $env:Path = "$base;$env:Path"
        }
    }
}

function Test-NpmAvailable {
    return [bool](Get-Command npm.cmd -ErrorAction SilentlyContinue) -or [bool](Get-Command npm -ErrorAction SilentlyContinue)
}

function Try-InstallNodeWithWinget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        return $false
    }
    Write-Host ""
    Write-Host "npm not in PATH. Trying winget install Node.js LTS (silent, may show UAC once) ..."
    & winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements -h
    Refresh-EnvPath
    return (Test-NpmAvailable)
}

function Show-DeployHelp {
    $p = Join-Path $Root "DEPLOY_WORKER_HELP.txt"
    if (Test-Path -LiteralPath $p) {
        Write-Host ""
        Get-Content -LiteralPath $p -Encoding UTF8 | Write-Host
    }
    $p2 = Join-Path $Root "NO_NODE_DASHBOARD_DEPLOY.txt"
    if (Test-Path -LiteralPath $p2) {
        Write-Host ""
        Write-Host "No Node? See also: NO_NODE_DASHBOARD_DEPLOY.txt in this folder."
    }
}

Refresh-EnvPath

if (-not (Test-NpmAvailable)) {
    $null = Try-InstallNodeWithWinget
    Refresh-EnvPath
}

if (-not (Test-NpmAvailable)) {
    Write-Host '[ERROR] npm not found (winget install did not succeed or needs admin).' -ForegroundColor Red
    Show-DeployHelp
    Read-Host 'Press Enter to exit'
    exit 1
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue) -and -not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
    Write-Host '[ERROR] npx not found. Close this window, open a new CMD, run deploy_worker.bat again.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

$nm = Join-Path $Root "node_modules"
if (-not (Test-Path -LiteralPath $nm)) {
    Write-Host "First run: npm install ..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[ERROR] npm install failed.' -ForegroundColor Red
        Read-Host 'Press Enter to exit'
        exit 1
    }
}

Write-Host "Deploying Cloudflare Worker ..."
# First account deploy: (1) Y = yes register workers.dev (2) next prompt = ACCOUNT subdomain string (NOT the letter Y).
$workersDevAccountSub = "a" + [guid]::NewGuid().ToString("n").Substring(0, 18)
Write-Host "If Wrangler asks for workers.dev subdomain, auto-using: $workersDevAccountSub"
Push-Location $Root
$stdin = "y`n$workersDevAccountSub`n"
$deployExit = 0
try {
    $deployLog = $stdin | & npx wrangler deploy 2>&1
    $deployExit = $LASTEXITCODE
    $deployLog | ForEach-Object { Write-Host $_ }
} catch {
    Write-Host $_ -ForegroundColor Red
    $deployExit = 1
}
Pop-Location
if ($deployExit -ne 0) {
    Write-Host '[ERROR] wrangler deploy failed. Try: npx wrangler login' -ForegroundColor Red
    Show-DeployHelp
    Read-Host 'Press Enter to exit'
    exit 1
}

Write-Host ""
Write-Host "OK. Next steps:"
Write-Host "  1) set secret: wrangler secret put FOOTBALL_DATA_TOKEN"
Write-Host ('  2) set config: window.__IOS_GAME_FOOTBALL_WORKER__ = "https://ios-game-football.' + $workersDevAccountSub + '.workers.dev";')
Write-Host "(If deploy used a different subdomain, copy the URL from the lines above.)"
Read-Host 'Press Enter to exit'
exit 0
