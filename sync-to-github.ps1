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

  $fetched = $false
  for ($i = 1; $i -le 3; $i++) {
    git fetch origin
    if ($LASTEXITCODE -eq 0) {
      $fetched = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $fetched) { throw "git fetch failed after 3 retries." }

  $statusHeader = git status --porcelain=v1 -b
  if ($statusHeader -match "No commits yet") {
    git checkout -f -B main origin/main
    if ($LASTEXITCODE -ne 0) {
      throw "bootstrap checkout failed."
    }
  }
  else {
    $pulled = $false
    for ($i = 1; $i -le 3; $i++) {
      git pull origin main
      if ($LASTEXITCODE -eq 0) {
        $pulled = $true
        break
      }
      Start-Sleep -Seconds 2
    }
    if (-not $pulled) { throw "git pull failed after 3 retries." }
  }
  git branch --set-upstream-to=origin/main main 2>$null
  Write-Host "Repo is connected to origin/main." -ForegroundColor Green
}

Assert-Git
Ensure-Repo

switch ($Action) {
  "pull" {
    $pulled = $false
    for ($i = 1; $i -le 3; $i++) {
      git pull origin main
      if ($LASTEXITCODE -eq 0) {
        $pulled = $true
        break
      }
      Start-Sleep -Seconds 2
    }
    if (-not $pulled) { throw "git pull failed after 3 retries." }
  }
  "push" {
    git add -A
    $status = git status --porcelain
    if (-not $status) {
      Write-Host "No local changes to commit." -ForegroundColor Yellow
      $pushed = $false
      for ($i = 1; $i -le 3; $i++) {
        git push origin main
        if ($LASTEXITCODE -eq 0) {
          $pushed = $true
          break
        }
        Start-Sleep -Seconds 2
      }
      if (-not $pushed) { throw "git push failed after 3 retries." }
      return
    }

    if (-not $Message) {
      $Message = "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
    $pushed = $false
    for ($i = 1; $i -le 3; $i++) {
      git push origin main
      if ($LASTEXITCODE -eq 0) {
        $pushed = $true
        break
      }
      Start-Sleep -Seconds 2
    }
    if (-not $pushed) { throw "git push failed after 3 retries. Try pull first." }
    Write-Host "Pushed to GitHub." -ForegroundColor Green
  }
}
