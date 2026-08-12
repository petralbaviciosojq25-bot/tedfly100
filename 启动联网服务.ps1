$node = 'C:\Users\QPF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$server = Join-Path $PSScriptRoot 'poker_trainer_server.mjs'

if (-not (Test-Path -LiteralPath $node)) {
  Write-Host 'Bundled Node.js was not found.' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

$env:AUTO_UPDATE_MS = '86400000'
Write-Host 'Poker Trainer update server: http://localhost:8787/' -ForegroundColor Green
Write-Host 'Close this window to stop the server.' -ForegroundColor Yellow
& $node $server
