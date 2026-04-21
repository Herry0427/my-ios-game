#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Ensure-GitOnPath {
  if (Get-Command git -ErrorAction SilentlyContinue) { return }
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
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git not found. Reopen Cursor after Git installation."
  }
}

Ensure-GitOnPath

# One-click setup for git author info.
git config --global user.name "Herry0427"
git config --global user.email "liu.heng.9627@gmail.com"

# Safer flow: pull first, then push.
Write-Host "Step 1/2: pull remote changes..." -ForegroundColor Cyan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\sync-to-github.ps1" pull
if ($LASTEXITCODE -ne 0) {
  throw "pull failed. Resolve conflicts and run again."
}

Write-Host "Step 2/2: push local changes..." -ForegroundColor Cyan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\sync-to-github.ps1" push
if ($LASTEXITCODE -ne 0) {
  throw "push failed. Check terminal output."
}
