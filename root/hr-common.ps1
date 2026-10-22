# Regina.HR on Windows: what the setup, the updater and the SQL importer share.
# HRSYSTEM_ROOT / HRSYSTEM_DATA can point somewhere else for tests; the defaults are the real install.
$script:Root = if ($env:HRSYSTEM_ROOT) { $env:HRSYSTEM_ROOT } else { 'C:\HRSystem' }
$script:DataRoot = if ($env:HRSYSTEM_DATA) { $env:HRSYSTEM_DATA } else { 'C:\HRSystemData' }
$script:Releases = Join-Path $script:Root 'releases'
$script:CurrentFile = Join-Path $script:Root 'current.txt'
$script:EnvFile = Join-Path $script:Root '.env'
$script:TokenFile = Join-Path $script:Root 'github.token'
$script:UpdateConfig = Join-Path $script:Root 'update.json'
$script:Backups = Join-Path $script:DataRoot 'Backups'
$script:TaskName = if ($env:HRSYSTEM_TASK) { $env:HRSYSTEM_TASK } else { 'HRSystem' }

function Banner([string]$Text) { Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host $Text -ForegroundColor Green }
function Warn([string]$Text) { Write-Host $Text -ForegroundColor Yellow }

function Is-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Find-Exe([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($base in @('C:\Program Files\MySQL', 'C:\Program Files (x86)\MySQL', 'C:\Program Files\MariaDB*')) {
    foreach ($dir in (Get-ChildItem $base -Directory -ErrorAction SilentlyContinue)) {
      $f = Get-ChildItem $dir.FullName -Filter $Name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($f) { return $f.FullName }
    }
  }
  return $null
}

# The settings of the installation (.env) as a hashtable.
function Read-HrEnv {
  $map = @{}
  if (Test-Path $script:EnvFile) {
    Get-Content $script:EnvFile | ForEach-Object {
      $line = $_.Trim()
      if ($line -and -not $line.StartsWith('#')) {
        $i = $line.IndexOf('=')
        if ($i -ge 1) { $map[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1) }
      }
    }
  }
  return $map
}

function Use-HrEnv {
  $map = Read-HrEnv
  foreach ($key in $map.Keys) { [Environment]::SetEnvironmentVariable($key, $map[$key], 'Process') }
  return $map
}

function Get-InstalledVersion {
  if (-not (Test-Path $script:CurrentFile)) { return $null }
  return (Get-Content $script:CurrentFile -Raw).Trim()
}

# 1.2.10 > 1.2.9: compare the numbers one by one (-1, 0, 1).
function Compare-Version([string]$A, [string]$B) {
  $x = @(([regex]::Matches($A, '\d+') | ForEach-Object { [int]$_.Value }))
  $y = @(([regex]::Matches($B, '\d+') | ForEach-Object { [int]$_.Value }))
  for ($i = 0; $i -lt [Math]::Max($x.Count, $y.Count); $i++) {
    $p = if ($i -lt $x.Count) { $x[$i] } else { 0 }
    $q = if ($i -lt $y.Count) { $y[$i] } else { 0 }
    if ($p -ne $q) { return [Math]::Sign($p - $q) }
  }
  return 0
}

function Test-Health([int]$Port) {
  try { return ((Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3).Content -match '"ok":true') } catch { return $false }
}

function Wait-Health([int]$Port, [int]$Seconds = 60) {
  for ($i = 0; $i -lt $Seconds; $i += 2) {
    if (Test-Health $Port) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# Stops the app (only the node process that runs this installation's server.mjs) and starts it again from current.txt.
function Restart-HrApp {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    # not the dashboard (manager\server.mjs): ending it with the app made it vanish for minutes after every update
    if ($_.CommandLine -and $_.CommandLine -like "*$($script:Root)*server.mjs*" -and $_.CommandLine -notlike '*\manager\*') {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
  Start-Sleep -Seconds 2
  # the launcher (start-hrsystem.ps1) starts the app again when it stops; start it if it is not running
  $launcherRunning = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*start-hrsystem.ps1*' -and $_.CommandLine -like "*$($script:Root)*" }
  if (-not $launcherRunning) {
    if (Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $script:TaskName }
    else { Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $script:Root 'start-hrsystem.ps1')`"" -WindowStyle Hidden | Out-Null }
  }
}

# --- GitHub token (read-only), kept encrypted for this machine (Windows DPAPI), readable by administrators only
function Save-GitHubToken([string]$Token) {
  Add-Type -AssemblyName System.Security
  $bytes = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($Token.Trim()), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  Remove-Item $script:TokenFile -Force -ErrorAction SilentlyContinue
  Set-Content -Path $script:TokenFile -Value ([Convert]::ToBase64String($bytes)) -Encoding ascii
}
# The token: the environment, the encrypted file, or (never stored) the GitHub CLI when it is installed and signed in.
function Get-GitHubToken {
  if ($env:HRSYSTEM_GITHUB_TOKEN) { return $env:HRSYSTEM_GITHUB_TOKEN }
  if (Test-Path $script:TokenFile) {
    Add-Type -AssemblyName System.Security
    $bytes = [Convert]::FromBase64String((Get-Content $script:TokenFile -Raw).Trim())
    return [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
  }
  $gh = Get-Command gh.exe -ErrorAction SilentlyContinue
  if ($gh) { try { $t = (& $gh.Source auth token 2>$null | Select-Object -First 1); if ($t) { return $t.Trim() } } catch { } }
  return $null
}

# A secret typed in a small Windows dialog (paste works there; the black console often refuses it). The text is hidden unless
# "Shfaq" is ticked. Returns '' when the person presses "Kalo" (skip). Falls back to the console prompt if no dialog can be shown.
function Read-Secret([string]$Prompt) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'HRSystem Setup'
    $form.StartPosition = 'CenterScreen'
    $form.ClientSize = New-Object System.Drawing.Size(560, 170)
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.TopMost = $true
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Prompt
    $label.Location = New-Object System.Drawing.Point(12, 10)
    $label.Size = New-Object System.Drawing.Size(536, 50)
    $box = New-Object System.Windows.Forms.TextBox
    $box.UseSystemPasswordChar = $true
    $box.Location = New-Object System.Drawing.Point(12, 66)
    $box.Size = New-Object System.Drawing.Size(536, 24)
    $show = New-Object System.Windows.Forms.CheckBox
    $show.Text = 'Shfaq'
    $show.Location = New-Object System.Drawing.Point(12, 98)
    $show.Size = New-Object System.Drawing.Size(120, 22)
    $show.Add_CheckedChanged({ $box.UseSystemPasswordChar = -not $show.Checked })
    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = 'OK'
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $ok.Location = New-Object System.Drawing.Point(368, 128)
    $skip = New-Object System.Windows.Forms.Button
    $skip.Text = 'Kalo'
    $skip.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $skip.Location = New-Object System.Drawing.Point(458, 128)
    $form.AcceptButton = $ok
    $form.CancelButton = $skip
    $form.Controls.AddRange(@($label, $box, $show, $ok, $skip))
    $form.Add_Shown({ $form.Activate(); $box.Focus() | Out-Null })
    $result = $form.ShowDialog()
    $text = $box.Text.Trim()
    $form.Dispose()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) { return $text }
    return ''
  } catch {
    $secure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  }
}

# update.json: { "repo": "owner/name", "channel": "stable" | "test" }. One repository per client; "stable" follows the Releases that
# are not marked pre-release (what the client's live installation gets), "test" also takes pre-releases (the test environment gets a
# version first, and the owner promotes it to stable once it was tried).
function Get-UpdateSettings {
  $settings = @{ repo = 'rogestshalaa/HRSystem-ReginaCenter'; channel = 'stable' }
  if (Test-Path $script:UpdateConfig) {
    try {
      $j = Get-Content $script:UpdateConfig -Raw | ConvertFrom-Json
      if ($j.repo) { $settings.repo = [string]$j.repo }
      if ($j.channel) { $settings.channel = [string]$j.channel }
    } catch { }
  }
  return $settings
}
function Get-UpdateRepo { return (Get-UpdateSettings).repo }
function Save-UpdateSettings([string]$Repo, [string]$Channel) {
  Remove-Item $script:UpdateConfig -Force -ErrorAction SilentlyContinue   # an old file with other permissions must not block the new one
  Set-Content -Path $script:UpdateConfig -Value (@{ repo = $Repo; channel = $Channel } | ConvertTo-Json) -Encoding ascii
}

function Get-GitHubHeaders([string]$Token) {
  return @{ Authorization = "Bearer $Token"; 'User-Agent' = 'regina-updater'; Accept = 'application/vnd.github+json' }
}

# The Release to install: stable = the newest that is not a pre-release; test = the newest version tag including pre-releases
# (tags like test-3.0.0 are reference builds and are never offered).
function Get-TargetRelease([string]$Repo, [string]$Token, [string]$Channel) {
  $headers = Get-GitHubHeaders $Token
  if ($Channel -ne 'test') { return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers }
  $all = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=30" -Headers $headers
  $best = $null
  foreach ($r in $all) {
    if ($r.draft -or $r.tag_name -notmatch '^[vV]\d+(\.\d+)*$') { continue }
    if (-not $best -or (Compare-Version $r.tag_name $best.tag_name) -gt 0) { $best = $r }
  }
  if (-not $best) { throw "Nuk u gjet asnje Release me version ne $Repo." }
  return $best
}
function Find-AppAsset($Release) {
  # The app zip is HRSystem-<version>.zip (from 1.0.2) or, in the older Releases, HRSystemV<version>-Hostinger.zip.
  return $Release.assets | Where-Object { $_.name -match '^HRSystem-\d+\.\d+\.\d+\.zip$' -or $_.name -like '*-Hostinger.zip' } | Select-Object -First 1
}

# GitHub sends the file from another address; the token must not follow it, so the redirect is followed by hand.
function Save-ReleaseAsset([string]$Url, [string]$Token, [string]$Target) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $request = [Net.HttpWebRequest]::Create($Url)
  $request.AllowAutoRedirect = $false
  $request.UserAgent = 'regina-updater'
  $request.Accept = 'application/octet-stream'
  $request.Headers.Add('Authorization', "Bearer $Token")
  $response = $request.GetResponse()
  try {
    if ([int]$response.StatusCode -in 301, 302, 303, 307, 308) {
      $location = $response.Headers['Location']
      $response.Close()
      Invoke-WebRequest -UseBasicParsing -Uri $location -OutFile $Target | Out-Null
    } else {
      $file = [IO.File]::Create($Target)
      try { $response.GetResponseStream().CopyTo($file) } finally { $file.Close() }
    }
  } finally { $response.Close() }
}

# A database backup (a .sql file) before anything changes; the last 14 are kept.
function Backup-Database {
  $mysqldump = Find-Exe 'mysqldump.exe'
  if (-not $mysqldump) { throw 'mysqldump.exe nuk u gjet: backup-i i databazes nuk mund te behet.' }
  $cfg = Read-HrEnv
  New-Item -ItemType Directory -Force -Path $script:Backups | Out-Null
  # <database name>-<date>-<time>.sql, e.g. regina-20261022-141108.sql
  $dbLabel = if ($cfg['DB_NAME']) { $cfg['DB_NAME'] } else { 'hrsystem' }
  $file = Join-Path $script:Backups ($dbLabel + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')
  $old = $env:MYSQL_PWD
  $env:MYSQL_PWD = $cfg['DB_PASSWORD']
  try {
    & $mysqldump "--user=$($cfg['DB_USER'])" '--protocol=TCP' "--host=$($cfg['DB_HOST'])" "--port=$($cfg['DB_PORT'])" '--single-transaction' '--no-tablespaces' '--hex-blob' '--default-character-set=utf8mb4' "--result-file=$file" $cfg['DB_NAME']
    if ($LASTEXITCODE -ne 0) { throw 'mysqldump deshtoi.' }
  } finally { $env:MYSQL_PWD = $old }
  # the newest 14 are kept, or more when the dashboard keeps more (its automatic-backup setting)
  $keep = 14
  try { $ds = Get-Content (Join-Path $script:Root 'dashboard-settings.json') -Raw | ConvertFrom-Json; if ($ds.autoBackupKeep -gt 14) { $keep = [int]$ds.autoBackupKeep } } catch { }
  Get-ChildItem $script:Backups -Filter ($dbLabel + '-*.sql') | Sort-Object LastWriteTime -Descending | Select-Object -Skip $keep | Remove-Item -Force -ErrorAction SilentlyContinue
  return $file
}

function Show-Result([bool]$Success, [string]$Message) {
  Write-Host ''
  if ($Success) {
    Write-Host '################################' -ForegroundColor Green
    Write-Host "  SUKSES: $Message" -ForegroundColor Green
    Write-Host '################################' -ForegroundColor Green
  } else {
    Write-Host '################################' -ForegroundColor Red
    Write-Host "  GABIM: $Message" -ForegroundColor Red
    Write-Host '################################' -ForegroundColor Red
  }
}
