# Eventually — publish the site to GitHub Pages.
#
#   .\publish.ps1 "what changed"
#
# Replaces the old drag-and-drop upload, which silently dropped files twice.
# A push here either lands completely or fails and says why.
#
# The pull comes first on purpose: the daily SEO Action commits the generated
# city pages straight to the repo, so its work has to come down before yours
# goes up — otherwise you'd eventually overwrite fresh pages with stale ones.

param([string]$Message = "Update site")

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "1/4  Fetching anything new from GitHub..." -ForegroundColor Cyan
git pull --rebase
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Pull failed - nothing has been sent. Send the message above to Claude." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "2/4  Checking what changed..." -ForegroundColor Cyan
git add -A
$changes = git status --porcelain
if (-not $changes) {
  Write-Host "Nothing to publish - everything is already live." -ForegroundColor Yellow
  exit 0
}
git status --short

Write-Host ""
Write-Host "3/4  Saving..." -ForegroundColor Cyan
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Host "Commit failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "4/4  Publishing..." -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Push failed - your work is saved locally, nothing is lost." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Published. GitHub Pages takes 1-2 minutes to go live." -ForegroundColor Green
Write-Host "Check: https://eventually-app.com/version.json" -ForegroundColor Green
Write-Host ""
