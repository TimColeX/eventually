# Eventually — tiny static server (no Node/Python required).
# Run:  powershell -ExecutionPolicy Bypass -File .\serve.ps1
# Then open http://localhost:8080/  (needed for PWA install / service worker).

param([int]$Port = 8080)

$root = $PSScriptRoot
$mime = @{
  '.html'='text/html'; '.css'='text/css'; '.js'='application/javascript';
  '.json'='application/json'; '.webmanifest'='application/manifest+json';
  '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon';
  '.mp3'='audio/mpeg'; '.m4a'='audio/mp4'; '.ogg'='audio/ogg'; '.wav'='audio/wav'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Eventually running at http://localhost:$Port/  (Ctrl+C to stop)" -ForegroundColor Cyan

while ($listener.IsListening) {
  $ctx = $null
  try {
    $ctx = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
    $file = Join-Path $root $path
    # Serve <dir>/index.html for directory requests like /admin/ (as GitHub Pages does).
    if (Test-Path $file -PathType Container) { $file = Join-Path $file 'index.html' }
    $isHead = $ctx.Request.HttpMethod -eq 'HEAD'

    if (Test-Path $file -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ctype = $mime[$ext]; if (-not $ctype) { $ctype = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentType = $ctype
      $ctx.Response.Headers['Cache-Control'] = 'no-cache'
      $ctx.Response.ContentLength64 = $bytes.Length
      if (-not $isHead) { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $ctx.Response.ContentLength64 = $msg.Length
      if (-not $isHead) { $ctx.Response.OutputStream.Write($msg, 0, $msg.Length) }
    }
  } catch {
    # one bad/aborted request must never take down the server
    Write-Host "req error: $($_.Exception.Message)" -ForegroundColor DarkYellow
  } finally {
    if ($ctx) { try { $ctx.Response.OutputStream.Close() } catch {} }
  }
}
$listener.Stop()
