# Regina.HR SQL importer (sql-import.bat): runs one .sql file on the database of this installation and says SUKSES or GABIM.
#   sql-import.bat                 opens a window to choose the file
#   sql-import.bat <skedari.sql>   runs that file
# A database backup is made first. A file that is a whole database dump (it has CREATE TABLE, e.g. from phpMyAdmin) replaces the
# database: after a PO the existing tables are dropped first, MariaDB-only collations are replaced, CREATE DATABASE / USE lines are
# skipped and the migrations the dump does not have yet are run at the end.
param([string]$File = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'hr-common.ps1')
try { Start-Transcript -Path (Join-Path $script:Root 'Sql-Import.log') -Append | Out-Null } catch { }

function Invoke-MysqlFile([string]$Mysql, $Cfg, [string]$SqlFile) {
  $errFile = Join-Path $env:TEMP 'hr-sql-import-error.txt'
  if (Test-Path $errFile) { Remove-Item $errFile -Force }
  $old = $env:MYSQL_PWD
  $env:MYSQL_PWD = $Cfg['DB_PASSWORD']
  try {
    # mysql reads the file from stdin; started directly (no cmd.exe) so paths with spaces need no extra quoting.
    $mysqlArgs = @("--user=$($Cfg['DB_USER'])", '--protocol=TCP', "--host=$($Cfg['DB_HOST'])", "--port=$($Cfg['DB_PORT'])", '--default-character-set=utf8mb4', $Cfg['DB_NAME'])
    $proc = Start-Process -FilePath $Mysql -ArgumentList $mysqlArgs -RedirectStandardInput $SqlFile -RedirectStandardError $errFile -Wait -NoNewWindow -PassThru
    $code = $proc.ExitCode
  } finally { $env:MYSQL_PWD = $old }
  $errors = if (Test-Path $errFile) { (Get-Content $errFile | Where-Object { $_ -notmatch 'Using a password on the command line' }) -join "`n" } else { '' }
  return @{ Code = $code; Errors = $errors }
}

try {
  if (-not (Is-Admin) -and -not $env:HRSYSTEM_ROOT) { throw 'Hape sql-import.bat si Administrator.' }  # a test root (HRSYSTEM_ROOT) cannot touch the real install
  $cfg = Use-HrEnv
  if (-not $cfg['DB_NAME']) { throw "Regina.HR nuk eshte instaluar ne $($script:Root) (mungon .env)." }
  if (-not $File) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Zgjidh skedarin SQL'
    $dialog.Filter = 'SQL (*.sql)|*.sql|Te gjitha (*.*)|*.*'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Nuk u zgjodh asnje skedar.' }
    $File = $dialog.FileName
  }
  if (-not (Test-Path $File)) { throw "Skedari nuk u gjet: $File" }
  $File = (Resolve-Path $File).Path
  Banner 'Skedari'
  Write-Host "$File ($([Math]::Round((Get-Item $File).Length / 1KB, 1)) KB)"
  Write-Host "Databaza: $($cfg['DB_NAME']) ($($cfg['DB_HOST']):$($cfg['DB_PORT']))"

  $mysql = Find-Exe 'mysql.exe'
  if (-not $mysql) { throw 'mysql.exe nuk u gjet.' }
  $fullDump = [bool](Select-String -Path $File -Pattern 'CREATE TABLE' -SimpleMatch -List -ErrorAction SilentlyContinue)
  if ($fullDump) {
    Write-Host ''
    Write-Host 'Ky skedar duket si databaze e plote (ka CREATE TABLE).' -ForegroundColor Yellow
    Write-Host "Do te FSHIHEN tabelat ekzistuese te databazes '$($cfg['DB_NAME'])' dhe do te ngarkohet ky skedar. Para kesaj behet backup." -ForegroundColor Yellow
    $answer = Read-Host 'Shkruaj PO per te vazhduar (Enter = anulo)'
    if ($answer.Trim().ToUpper() -ne 'PO') { throw 'Anuluar: asgje nuk u ndryshua.' }
  }

  Banner 'Backup i databazes'
  $backup = Backup-Database
  Ok "U ruajt: $backup"

  $toRun = $File
  $temps = @()
  if ($fullDump) {
    Banner 'Po pergatitet skedari'
    # MariaDB 11.4+ collations do not exist in MySQL 8.4 (the standard one is the same for this app); CREATE DATABASE / USE would leave our database.
    $toRun = Join-Path $env:TEMP ('hr-import-' + [guid]::NewGuid().ToString('N') + '.sql')
    $temps += $toRun
    $reader = New-Object System.IO.StreamReader($File, [Text.Encoding]::UTF8)
    $writer = New-Object System.IO.StreamWriter($toRun, $false, (New-Object Text.UTF8Encoding($false)))
    try {
      while ($null -ne ($line = $reader.ReadLine())) {
        $trim = $line.TrimStart()
        if ($trim.StartsWith('CREATE DATABASE', [StringComparison]::OrdinalIgnoreCase) -or $trim.StartsWith('USE ', [StringComparison]::OrdinalIgnoreCase)) { $writer.WriteLine('-- (anashkaluar) ' + $line); continue }
        if ($line.Contains('utf8mb4_uca1400_')) { $line = [regex]::Replace($line, 'utf8mb4_uca1400_[a-z_0-9]+', 'utf8mb4_unicode_ci') }
        $writer.WriteLine($line)
      }
    } finally { $reader.Dispose(); $writer.Dispose() }

    Banner 'Po fshihen tabelat ekzistuese'
    $old = $env:MYSQL_PWD
    $env:MYSQL_PWD = $cfg['DB_PASSWORD']
    try {
      $tables = & $mysql "--user=$($cfg['DB_USER'])" '--protocol=TCP' "--host=$($cfg['DB_HOST'])" "--port=$($cfg['DB_PORT'])" '-N' '-B' '-e' "SHOW FULL TABLES WHERE Table_type='BASE TABLE'" $cfg['DB_NAME']
      if ($LASTEXITCODE -ne 0) { throw "Lista e tabelave nuk u lexua. (Backup: $backup)" }
    } finally { $env:MYSQL_PWD = $old }
    $dropFile = Join-Path $env:TEMP ('hr-drop-' + [guid]::NewGuid().ToString('N') + '.sql')
    $temps += $dropFile
    $drops = @('SET FOREIGN_KEY_CHECKS=0;') + @($tables | Where-Object { $_ } | ForEach-Object { 'DROP TABLE IF EXISTS `' + (($_ -split "`t")[0]).Replace('`', '``') + '`;' }) + @('SET FOREIGN_KEY_CHECKS=1;')
    Set-Content -Path $dropFile -Value $drops -Encoding utf8
    $r = Invoke-MysqlFile $mysql $cfg $dropFile
    if ($r.Code -ne 0) { throw "Fshirja e tabelave deshtoi. $($r.Errors)  (Backup: $backup)" }
  }

  Banner 'Po ekzekutohet SQL'
  $r = Invoke-MysqlFile $mysql $cfg $toRun
  foreach ($t in $temps) { Remove-Item $t -Force -ErrorAction SilentlyContinue }
  if ($r.Code -ne 0) {
    Show-Result $false "SQL deshtoi. $($r.Errors)  (Backup para ndryshimit: $backup)"
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
  }

  if ($fullDump) {
    Banner 'Migrimet qe mungojne'
    $node = Find-Exe 'node.exe'
    $release = (Get-Content $script:CurrentFile -Raw).Trim()
    $releaseDir = Join-Path $script:Releases $release
    Push-Location $releaseDir
    try { $lines = & $node 'server/core/migrate-cli.mjs' 2>&1; $migrateCode = $LASTEXITCODE } finally { Pop-Location }
    $lines | ForEach-Object { Write-Host "  $_" }
    if ($migrateCode -ne 0) { Show-Result $false "Databaza u ngarkua, por migrimet deshtuan. (Backup: $backup)"; try { Stop-Transcript | Out-Null } catch { }; exit 1 }
  }
  Show-Result $true "SQL u ekzekutua: $(Split-Path $File -Leaf)"
  try { Stop-Transcript | Out-Null } catch { }
  exit 0
}
catch {
  Show-Result $false $_.Exception.Message
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
