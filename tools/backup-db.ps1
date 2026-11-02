# =============================================================================
# Eventually — take a backup of the Supabase database
#
# The free plan has NO automatic backups. The project dashboard says "No backups"
# and means it: if the database were lost there is nothing to restore from.
#
# 🔑 WHAT IS ACTUALLY AT RISK, because most of the database is not:
#   • `events` / `event_sources` — ~60,000 rows, and ALL of it re-ingestable from
#     Ticketmaster, Showpass and the feeds. Losing it costs a few hours of cron.
#   • Everything else is NOT recoverable at any price: native events organisers
#     published, accounts and profiles, EventCast scripts and approvals, saved and
#     attended events, registrations, sponsors, admin config, city content.
#   That second list is small, which is exactly why a backup is cheap here.
#
# 🔴 THE DUMP CONTAINS PERSONAL DATA (emails, profiles, addresses) AND THIS REPO IS
# PUBLIC. It is written OUTSIDE the repo, and the script refuses to write anywhere
# inside it. `.gitignore` carries a second guard. Do not defeat either.
#
# USAGE
#   pwsh tools/backup-db.ps1                 # or: powershell -File tools\backup-db.ps1
#   pwsh tools/backup-db.ps1 -Keep 14        # keep 14 archives instead of 7
#   pwsh tools/backup-db.ps1 -OutDir D:\backups
#
# The database password is the one from Supabase → Project Settings → Database.
# Set it once so the script never asks again, and it stays out of your shell history:
#   setx EVENTUALLY_DB_PASSWORD "…"      (then open a new terminal)
#
# RESTORING (you will not need this often, so it is written down here):
#   psql "<connection string>" -f roles.sql
#   psql "<connection string>" -f schema.sql
#   psql "<connection string>" -f data.sql
# =============================================================================

[CmdletBinding()]
param(
  [string] $OutDir = (Join-Path $env:USERPROFILE 'Eventually-backups'),
  [int]    $Keep   = 7
)

$ErrorActionPreference = 'Stop'

# --- Guard: never write a dump inside the repo (it is a public website) -------
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outFull  = [System.IO.Path]::GetFullPath($OutDir)
if ($outFull.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write backups inside the repository ($repoRoot). This repo is PUBLIC and a dump contains personal data. Pass -OutDir somewhere else."
}

# 🪤 NOT `supabase db dump`: that shells out to pg_dump INSIDE DOCKER, and this
# machine has no Docker (which is also why Edge Functions deploy with --use-api).
# Talking to pg_dump directly is one less thing that has to be installed.
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Host "pg_dump is not installed. One of:" -ForegroundColor Yellow
  Write-Host "  winget install -e --id PostgreSQL.PostgreSQL.17" -ForegroundColor Yellow
  Write-Host "  (then reopen the terminal so PATH picks it up)" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Or skip this entirely: the weekly GitHub Actions backup in the PRIVATE" -ForegroundColor Yellow
  Write-Host "backend repo needs nothing installed. See backend/.github/workflows/backup.yml." -ForegroundColor Yellow
  throw "pg_dump not found."
}

# --- The connection string ---------------------------------------------------
# Pooler host on port 5432 (session mode). ⚠️ The direct host db.<ref>.supabase.co is
# IPv6-only, and port 6543 is transaction mode, which pg_dump cannot use.
# A whole URL wins if you have one; otherwise it is built from the password.
$dbUrl = $env:EVENTUALLY_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  $pw = $env:EVENTUALLY_DB_PASSWORD
  if ([string]::IsNullOrWhiteSpace($pw)) {
    Write-Host "Neither EVENTUALLY_DB_URL nor EVENTUALLY_DB_PASSWORD is set." -ForegroundColor Yellow
    Write-Host "Supabase - Project Settings - Database - Database password." -ForegroundColor Yellow
    $secure = Read-Host -Prompt 'Database password' -AsSecureString
    $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  if ([string]::IsNullOrWhiteSpace($pw)) { throw "No password given - nothing dumped." }
  # ⚠️ URL-encode anything in the password that a URL treats specially, or the
  # connection string silently parses into the wrong host.
  $pwEnc = [System.Uri]::EscapeDataString($pw)
  $dbUrl = "postgresql://postgres.gpsetmqivzchlvyrcgld:$pwEnc@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
}

$stamp  = Get-Date -Format 'yyyy-MM-dd-HHmm'
$work   = Join-Path $OutDir "eventually-$stamp"
New-Item -ItemType Directory -Force -Path $work | Out-Null

# --- Two dumps: schema, then data --------------------------------------------
# Roles, then schema, then data. Separate files because that is the order you
# restore them in, and because a schema-only diff is the thing you actually read
# when you want to know what changed.
# COPY blocks (pg_dump's default) restore far faster than 60,000 INSERTs, and this
# dump exists to be restored under pressure.
$steps = @(
  @{ Name = 'schema.sql'; Args = @('--schema-only', '--schema=public', '--schema=storage') },
  @{ Name = 'data.sql';   Args = @('--data-only',   '--schema=public') }
)

foreach ($s in $steps) {
  $target = Join-Path $work $s.Name
  Write-Host ("Dumping {0} ..." -f $s.Name) -ForegroundColor Cyan
  $argv = @($dbUrl, '--no-owner', '--no-privileges', '-f', $target) + $s.Args
  # 🪤 $ErrorActionPreference='Stop' PLUS a native command that writes progress to
  # stderr is a trap in Windows PowerShell 5.1: "Dumping roles from remote database..."
  # is normal output, but PS wraps each stderr line in an ErrorRecord and the Stop
  # preference aborts the script. A SUCCESSFUL dump would have failed here.
  # So: relax the preference around the call only, and judge the result the way a shell
  # does — by the exit code, which is checked immediately below.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & pg_dump @argv 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
  finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw ("pg_dump failed on {0} (exit {1})" -f $s.Name, $LASTEXITCODE) }
  $kb = [math]::Round((Get-Item $target).Length / 1KB)
  Write-Host ("  {0} - {1} KB" -f $s.Name, $kb) -ForegroundColor DarkGray
}

# --- One archive per run, so rotation is a single file to reason about -------
$zip = Join-Path $OutDir "eventually-$stamp.zip"
Compress-Archive -Path (Join-Path $work '*') -DestinationPath $zip -Force
Remove-Item -Recurse -Force $work
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ("Wrote {0} ({1} MB)" -f $zip, $mb) -ForegroundColor Green

# --- Rotate ------------------------------------------------------------------
# Oldest first, delete everything past -Keep. A backup script that fills the disk
# is a backup script that gets switched off.
$all = Get-ChildItem -Path $OutDir -Filter 'eventually-*.zip' | Sort-Object LastWriteTime -Descending
if ($all.Count -gt $Keep) {
  $all | Select-Object -Skip $Keep | ForEach-Object {
    Write-Host ("Removing old backup {0}" -f $_.Name) -ForegroundColor DarkGray
    Remove-Item -Force $_.FullName
  }
}

Write-Host ""
Write-Host ("{0} backup(s) in {1}" -f (Get-ChildItem -Path $OutDir -Filter 'eventually-*.zip').Count, $OutDir)
Write-Host "A backup on one machine is not a backup. Copy these somewhere else as well." -ForegroundColor Yellow
