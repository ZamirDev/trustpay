# Builds the distributable TrustPay Guard zip (runtime files only).
# Run from anywhere:  powershell -File "'"$PWD\extension\build-zip.ps1"'
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot        # repo root (trustpay/)
$name = 'trustpay-guard-v0.2.0.zip'
$out  = Join-Path $root 'extension-dist'

$files = @(
  'manifest.json',
  'background.js',
  'guardInPage.js',
  'pageScan.js',
  'riskModel.js',
  'popup.html',
  'popup.js',
  'guard.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'INSTALL.md'
)

New-Item -ItemType Directory -Force -Path $out | Out-Null
$zip = Join-Path $out $name
if (Test-Path $zip) { Remove-Item $zip -Force }

$staging = Join-Path $env:TEMP ('tp-guard-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  foreach ($f in $files) {
    $src = Join-Path $PSScriptRoot $f
    if (-not (Test-Path $src)) { throw "missing runtime file: $f" }
    $dst = Join-Path $staging $f
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item $src $dst
  }
  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force
  Write-Output "Built $zip"
} finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}