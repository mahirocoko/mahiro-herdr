$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
& node (Join-Path $Root 'bin\mahiro-herdr.mjs') uninstall-live $Root
exit $LASTEXITCODE
