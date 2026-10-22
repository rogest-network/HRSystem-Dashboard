# Regina.HR updater (update.bat): puts a newer version on this computer.
#   update.bat            looks at GitHub for the newest Release, and installs it if it is newer than the installed one
#   update.bat check      only says whether a newer version exists
#   update.bat <zip>      installs that HRSystemV<x>-Hostinger.zip (no GitHub needed)
# Steps: database backup -> unzip -> install packages and build -> the SQL of the version (migrations) -> switch -> health check;
# if the new version does not answer, the old one is put back. The end says SUKSES or GABIM.
param([string]$Zip = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'hr-common.ps1')

$checkOnly = ($Zip -eq 'check')
if ($checkOnly) { $Zip = '' }
New-Item -ItemType Directory -Force -Path $script:Root | Out-Null
try { Start-Transcript -Path (Join-Path $script:Root 'Updater.log') -Append | Out-Null } catch { }

try {
  if (-not (Is-Admin) -and -not $env:HRSYSTEM_ROOT) { throw 'Hape update.bat si Administrator.' }  # a test root (HRSYSTEM_ROOT) cannot touch the real install
  $installed = Get-InstalledVersion
  $installedVersion = $installed -replace '-b\d+$', ''   # a rebuild of the same version is installed as <version>-b2, -b3 ...
  if (-not $installed) { throw "Regina.HR nuk eshte instaluar ne $($script:Root) (mungon current.txt)." }
  $cfg = Use-HrEnv
  $port = [int]$cfg['PORT']
  if (-not $port) { $port = 3000 }
  Banner 'Versioni i instaluar'
  Write-Host $installed

  $tempZip = $null
  if ($Zip) {
    if (-not (Test-Path $Zip)) { throw "Skedari nuk u gjet: $Zip" }
    $zipPath = (Resolve-Path $Zip).Path
  } else {
    Banner 'GitHub'
    $token = Get-GitHubToken
    if (-not $token) { throw 'Mungon tokeni i GitHub (github.token). Shtoje me setup.bat, ose perdor: update.bat <skedari.zip>' }
    $settings = Get-UpdateSettings
    $repo = $settings.repo
    $release = Get-TargetRelease $repo $token $settings.channel
    $latest = $release.tag_name.TrimStart('v', 'V')
    Write-Host "Versioni me i ri ne GitHub ($repo, kanali $($settings.channel)): $latest"
    $asset = Find-AppAsset $release
    # While a version is being stabilised its Release gets a new zip under the same number: the marker tells if this one is installed.
    $assetMark = if ($asset) { "$($asset.id):$($asset.updated_at)" } else { '' }
    $markFile = Join-Path (Join-Path $script:Releases $installed) '.asset'
    $sameBuild = (Test-Path $markFile) -and ((Get-Content $markFile -Raw).Trim() -eq $assetMark)
    $newer = (Compare-Version $latest $installedVersion) -gt 0
    if (-not $newer -and ((Compare-Version $latest $installedVersion) -lt 0 -or $sameBuild)) {
      Show-Result $true "Ke versionin me te ri ($installed). Nuk ka cfare te perditesohet."
      try { Stop-Transcript | Out-Null } catch { }
      exit 0
    }
    if ($checkOnly) {
      Show-Result $true "Ka version te ri: $latest (ti ke $installed). Hape update.bat pa 'check' per ta instaluar."
      try { Stop-Transcript | Out-Null } catch { }
      exit 0
    }
    if (-not $asset) { throw "Release $($release.tag_name) nuk ka skedarin e aplikacionit (HRSystem-<versioni>.zip)." }
    $tempZip = Join-Path $env:TEMP $asset.name
    Write-Host "Po shkarkohet $($asset.name) ($([Math]::Round($asset.size / 1MB, 1)) MB)..."
    Save-ReleaseAsset $asset.url $token $tempZip
    if ((Get-Item $tempZip).Length -ne $asset.size) { throw 'Shkarkimi nuk u plotesua (madhesia nuk perputhet).' }
    $zipPath = $tempZip
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  $reader = New-Object IO.StreamReader($archive.GetEntry('package.json').Open())
  $newVersion = ($reader.ReadToEnd() | ConvertFrom-Json).version
  $reader.Close(); $archive.Dispose()
  Banner "Versioni i ri: $newVersion"
  if ($newVersion -eq $installed -and $Zip) {
    Show-Result $true "Versioni $installed eshte tashme i instaluar."
    try { Stop-Transcript | Out-Null } catch { }
    exit 0
  }
  $newName = $newVersion
  for ($n = 2; (Test-Path (Join-Path $script:Releases $newName)) -and ($newName -eq $installed); $n++) { $newName = "$newVersion-b$n" }

  Banner 'Backup i databazes'
  $backup = Backup-Database
  Ok "U ruajt: $backup"

  Banner 'Skedaret e versionit'
  $releaseDir = Join-Path $script:Releases $newName
  if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $releaseDir -Force

  Banner 'Paketat dhe build (disa minuta)'
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  Push-Location $releaseDir
  try {
    if (Test-Path 'package-lock.json') { Remove-Item 'package-lock.json' -Force }
    npm install --include=optional --no-audit --no-fund 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'npm install deshtoi.' }
    npm run build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Warn 'Build-i deshtoi; po riparohet Rollup per Windows...'
      npm install --no-save --include=optional --no-audit --no-fund '@rollup/rollup-win32-x64-msvc' 2>&1 | Out-Null
      npm run build 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'npm run build deshtoi.' }
    }
    npm run check 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'npm run check deshtoi.' }
    npm prune --omit=dev --omit=optional 2>&1 | Out-Null
  } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $releaseDir 'dist\index.html'))) { throw 'Build-i nuk krijoi dist\index.html.' }
  if ($assetMark) { Set-Content -Path (Join-Path $releaseDir '.asset') -Value $assetMark -NoNewline }
  Ok 'Build-i u krye.'

  Banner 'SQL i versionit (migrimet)'
  Push-Location $releaseDir
  try {
    $lines = & $node 'server/core/migrate-cli.mjs' 2>&1
    $code = $LASTEXITCODE
  } finally { Pop-Location }
  $lines | ForEach-Object { Write-Host "  $_" }
  if ($code -ne 0) {
    Show-Result $false "SQL-i i versionit $newVersion deshtoi. Asgje nuk u ndryshua te aplikacioni (versioni $installed vazhdon). Backup: $backup"
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
  }
  Ok 'SQL u ekzekutua me sukses.'

  Banner 'Ndrrimi i versionit'
  Set-Content -Path $script:CurrentFile -Value $newName -NoNewline
  Restart-HrApp
  if (Wait-Health $port 60) {
    Get-ChildItem $script:Releases -Directory | Where-Object { $_.Name -ne $newName -and $_.Name -ne $installed } |
      Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Show-Result $true "Regina.HR u perditesua nga $installed ne $newVersion."
    try { Stop-Transcript | Out-Null } catch { }
    exit 0
  }
  Warn "Versioni $newVersion nuk u pergjigj. Po kthehet versioni $installed..."
  Set-Content -Path $script:CurrentFile -Value $installed -NoNewline
  Restart-HrApp
  $back = Wait-Health $port 60
  Show-Result $false ("Versioni $newVersion nuk u pergjigj" + $(if ($back) { "; u kthye versioni $installed." } else { "; edhe versioni $installed nuk pergjigjet: shiko HRSystem-Server.log." }) + " Backup: $backup")
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
catch {
  Show-Result $false $_.Exception.Message
  Write-Host "Log: $(Join-Path $script:Root 'Updater.log')" -ForegroundColor Yellow
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
