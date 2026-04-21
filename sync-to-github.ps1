#Requires -Version 5.1
<#
.SYNOPSIS
  Sync local folder with https://github.com/Herry0427/my-ios-game

.DESCRIPTION
  Usage:
    .\sync-to-github.ps1 pull
    .\sync-to-github.ps1 push
    .\sync-to-github.ps1 push "your commit message"
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet("pull", "push")]
  [string]$Action = "push",

  [Parameter(Position = 1)]
  [string]$Message = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$RemoteUrl = "https://github.com/Herry0427/my-ios-game.git"
$GitRetries = 6

function Invoke-GitRetry {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  for ($i = 1; $i -le $GitRetries; $i++) {
    & $Command
    if ($LASTEXITCODE -eq 0) { return $true }
    $wait = [Math]::Min(20, 2 * $i)
    Write-Host "$Label failed (attempt $i/$GitRetries), retry in ${wait}s..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds $wait
  }
  return $false
}

function Assert-Git {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    foreach ($p in @(
        "C:\Program Files\Git\cmd",
        "C:\Program Files\Git\bin",
        "C:\Program Files (x86)\Git\cmd",
        "C:\Program Files (x86)\Git\bin"
      )) {
      if (Test-Path $p) {
        $env:Path = "$p;$env:Path"
      }
    }
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git not found. Reopen Cursor after Git installation."
  }
  git config --global http.version HTTP/1.1 | Out-Null
}

function Ensure-Repo {
  $gitDir = Join-Path $PSScriptRoot ".git"
  if (-not (Test-Path $gitDir)) {
    Write-Host "Init local repo and connect remote..." -ForegroundColor Cyan
    git init -b main 2>$null
    if ($LASTEXITCODE -ne 0) { git init | Out-Null }
  }

  git branch -M main 2>$null | Out-Null

  $remotes = git remote
  if ($remotes -notcontains "origin") {
    git remote add origin $RemoteUrl
  }

  $fetched = Invoke-GitRetry -Command { git fetch origin } -Label "git fetch"
  if (-not $fetched) { throw "git fetch failed after retries." }

  $statusHeader = git status --porcelain=v1 -b
  if ($statusHeader -match "No commits yet") {
    git checkout -f -B main origin/main
    if ($LASTEXITCODE -ne 0) {
      throw "bootstrap checkout failed."
    }
  }
  else {
    $pulled = Invoke-GitRetry -Command { git pull origin main } -Label "git pull"
    if (-not $pulled) { throw "git pull failed after retries." }
  }
  git branch --set-upstream-to=origin/main main 2>$null
  Write-Host "Repo is connected to origin/main." -ForegroundColor Green
}

Assert-Git
Ensure-Repo

switch ($Action) {
  "pull" {
    $pulled = Invoke-GitRetry -Command { git pull origin main } -Label "git pull"
    if (-not $pulled) { throw "git pull failed after retries." }
  }
  "push" {
    git add -A
    $status = git status --porcelain
    if (-not $status) {
      Write-Host "No local changes to commit." -ForegroundColor Yellow
      $pushed = Invoke-GitRetry -Command { git push origin main } -Label "git push"
      if (-not $pushed) { throw "git push failed after retries." }
      return
    }

    if (-not $Message) {
      $Message = "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
    $pushed = Invoke-GitRetry -Command { git push origin main } -Label "git push"
    if (-not $pushed) { throw "git push failed after retries. Try pull first." }
    Write-Host "Pushed to GitHub." -ForegroundColor Green
  }
}
