# Dot-source this file from PowerShell: . ./scripts/windows-env.ps1
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $projectRoot 'build/tools'
$portableMsvc = Join-Path $toolRoot 'msvc/setup_x64.bat'
if (Test-Path -LiteralPath $portableMsvc) {
    # Import the toolchain's environment without changing machine/user settings.
    $toolEnvironment = & $env:ComSpec /d /c "call `"$portableMsvc`" && set"
    if ($LASTEXITCODE -ne 0) { throw 'Could not load the portable C++ toolchain' }
    foreach ($line in $toolEnvironment) {
        if ($line -match '^([^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
    $env:DISTUTILS_USE_SDK = '1'
}
$portableGit = Join-Path $toolRoot 'git/cmd/git.exe'
$gitExecutable = if (Test-Path -LiteralPath $portableGit) { $portableGit } else { (Get-Command git -ErrorAction Stop).Source }
$gitUsrBin = Join-Path (Split-Path (Split-Path $gitExecutable -Parent) -Parent) 'usr/bin'
$paths = @(
    (Join-Path $toolRoot 'node'),
    (Join-Path $toolRoot 'git/cmd'),
    (Join-Path $toolRoot 'pnpm'),
    (Join-Path $projectRoot '.venv/Scripts'),
    (Join-Path $env:USERPROFILE '.cargo/bin'),
    (Join-Path $toolRoot 'msys/usr/bin'),
    $gitUsrBin
)
$env:PATH = ($paths -join ';') + ';' + $env:PATH
$env:ROLLINGPEBBLE_BUILD_PYTHON = Join-Path $projectRoot 'build/python-build-runtime/python.exe'
$env:PYTHONUTF8 = '1'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = 'link.exe'
