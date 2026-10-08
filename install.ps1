$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
& node (Join-Path $Root 'bin\mahiro-herdr.mjs') install $Root
exit $LASTEXITCODE
