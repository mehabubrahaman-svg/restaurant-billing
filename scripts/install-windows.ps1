# RestroOS one-line installer for Windows 10/11 (64-bit).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/mehabubrahaman-svg/restaurant-billing/claude/nifty-shannon-ahib6j/scripts/install-windows.ps1 | iex"
#
# Downloads the code from GitHub, a private copy of Node.js 22, the build
# tools the encrypted-SQLite module needs (Python and the Visual Studio 2022
# C++ Build Tools, only if missing, after asking), installs and builds the
# app, adds "RestroOS Hub" to the Start menu and the Desktop, and offers to
# start it. Run it again to update: the restaurant's data is kept.
#
# Without prompts (e.g. in CI):
#   & ([scriptblock]::Create((irm <url>))) -Yes -NoStart

param(
  [string]$Repo = 'mehabubrahaman-svg/restaurant-billing',
  [string]$Branch = 'claude/nifty-shannon-ahib6j',
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'RestroOS'),
  [switch]$Yes,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is far slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`nERROR: $text" -ForegroundColor Red; throw $text }
function Ask($question) {
  if ($Yes) { return $true }
  $answer = Read-Host "$question [Y/n]"
  return ($answer -eq '' -or $answer -match '^(y|yes)$')
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Have($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }

Write-Host 'RestroOS installer' -ForegroundColor Green
Write-Host "Installs to $InstallDir"
if (-not [Environment]::Is64BitOperatingSystem) { Fail 'RestroOS needs 64-bit Windows 10 or 11.' }

$appDir = Join-Path $InstallDir 'app'
$dataDir = Join-Path $InstallDir 'data'
$nodeDir = Join-Path $InstallDir 'node'
New-Item -ItemType Directory -Force -Path $InstallDir, $dataDir | Out-Null

# ---- Node.js 22 (a private copy: no admin rights, doesn't touch another Node) ------------
Step 'Node.js 22'
$nodeExe = Join-Path $nodeDir 'node.exe'
if (Test-Path $nodeExe) {
  Write-Host "Using $(& $nodeExe -v) in $nodeDir"
} else {
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $release = $index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1
  $name = "node-$($release.version)-win-x64"
  Write-Host "Downloading $name"
  $zip = Join-Path $env:TEMP "$name.zip"
  Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/$name.zip" -OutFile $zip
  $expected = ((Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt").Content -split "`n" |
    Where-Object { $_ -match "  $name\.zip$" }) -replace '\s.*$', ''
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { Fail "Node.js download checksum mismatch ($actual)" }
  Expand-Archive $zip -DestinationPath $InstallDir -Force
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Rename-Item (Join-Path $InstallDir $name) $nodeDir
  Remove-Item $zip
}
$env:Path = "$nodeDir;$env:Path"

# ---- Build tools for the native SQLite module --------------------------------------------
Step 'Build tools (Python and Visual Studio 2022 C++ Build Tools)'
$needWinget = $false
$python = (Have 'python') -and ((& python --version 2>&1) -match 'Python 3')
if (-not $python -and (Have 'py')) { $python = (& py -3 --version 2>&1) -match 'Python 3' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vcTools = $false
if (Test-Path $vswhere) {
  # node-gyp knows Visual Studio 2019 and 2022 (versions 16-17).
  $vcTools = [bool](& $vswhere -products * -version '[16.0,18.0)' -latest `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
}
Write-Host ("Python 3: " + $(if ($python) { 'found' } else { 'missing' }))
Write-Host ("Visual Studio C++ tools: " + $(if ($vcTools) { 'found' } else { 'missing' }))
if (-not $python -or -not $vcTools) {
  if (-not (Have 'winget')) {
    Fail ('winget (App Installer) is needed to install the build tools. Install "App Installer" ' +
      'from the Microsoft Store, or install Python 3 and the Visual Studio 2022 Build Tools ' +
      '("Desktop development with C++") yourself, then run this again.')
  }
  $what = @()
  if (-not $python) { $what += 'Python 3.12' }
  if (-not $vcTools) { $what += 'Visual Studio 2022 Build Tools with C++ (about 3 GB, asks for admin)' }
  if (-not (Ask "Install $($what -join ' and ')?")) { Fail 'The build tools are required.' }
  if (-not $python) {
    winget install --id Python.Python.3.12 -e --scope user --silent `
      --accept-package-agreements --accept-source-agreements
    Refresh-Path; $env:Path = "$nodeDir;$env:Path"
  }
  if (-not $vcTools) {
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent `
      --accept-package-agreements --accept-source-agreements `
      --override '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    if (-not (& $vswhere -products * -version '[16.0,18.0)' -latest `
          -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)) {
      Fail 'The Visual Studio Build Tools did not install. Restart Windows and run this again.'
    }
  }
}

# ---- The code ------------------------------------------------------------------------------
Step "Downloading RestroOS ($Branch)"
$zip = Join-Path $env:TEMP 'restroos.zip'
Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip
$unpack = Join-Path $env:TEMP 'restroos-src'
if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
Expand-Archive $zip -DestinationPath $unpack -Force
$source = Get-ChildItem $unpack -Directory | Select-Object -First 1
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force } # code only: data lives in $dataDir
Move-Item $source.FullName $appDir
Remove-Item $zip, $unpack -Recurse -Force

# ---- Install and build -----------------------------------------------------------------------
Step 'Installing dependencies (a few minutes the first time)'
Push-Location $appDir
try {
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  $env:COREPACK_HOME = Join-Path $InstallDir 'corepack'
  $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1' # the desktop shell isn't used by this install
  $env:npm_config_msvs_version = '2022'
  & corepack enable --install-directory $nodeDir
  if ($LASTEXITCODE) { Fail 'corepack could not set up pnpm' }
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE) { Fail 'pnpm install failed (see above)' }
  Step 'Building'
  & pnpm --filter @restroos/server --filter @restroos/web build
  if ($LASTEXITCODE) { Fail 'the build failed (see above)' }
} finally {
  Pop-Location
}

# ---- Launcher and shortcuts -------------------------------------------------------------------
Step 'Shortcuts'
$launcher = Join-Path $InstallDir 'Start RestroOS.cmd'
@"
@echo off
title RestroOS Hub
set "PATH=$nodeDir;%PATH%"
cd /d "$appDir"
start "" /b cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:7400"
node scripts\run-hub.mjs --data "$dataDir"
pause
"@ | Set-Content -Path $launcher -Encoding ASCII

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $link = $shell.CreateShortcut((Join-Path $folder 'RestroOS Hub.lnk'))
  $link.TargetPath = $launcher
  $link.WorkingDirectory = $InstallDir
  $link.IconLocation = (Join-Path $nodeDir 'node.exe') + ',0'
  $link.Description = 'Start the RestroOS restaurant server'
  $link.Save()
}

Write-Host "`nRestroOS is installed." -ForegroundColor Green
Write-Host "  Start it any time from the Desktop or Start menu: RestroOS Hub"
Write-Host "  Restaurant data: $dataDir (keep db.key with it)"
Write-Host "  First start: the setup code is shown in the RestroOS window; the browser opens http://localhost:7400"
Write-Host "  Windows may ask to allow Node.js through the firewall: allow it on Private networks so tablets can connect."

if (-not $NoStart -and (Ask 'Start RestroOS now?')) {
  Start-Process -FilePath $launcher -WorkingDirectory $InstallDir
}
