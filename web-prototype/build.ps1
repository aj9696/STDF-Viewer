param([switch]$SkipNative)
$ErrorActionPreference = 'Stop'
$prototypeRoot = $PSScriptRoot
$repositoryRoot = Split-Path $prototypeRoot -Parent
$runtimeSetup = Join-Path $repositoryRoot '.venv/runtime-environment.ps1'
if (!(Test-Path -LiteralPath $runtimeSetup)) {
    throw 'Set up the repository local Rust environment first; .venv/runtime-environment.ps1 is required.'
}
. $runtimeSetup
$env:CARGO_TARGET_DIR = Join-Path $repositoryRoot '.venv/toolchain/web-target'
$bindgenVersion = '0.2.128'
$toolsRoot = Join-Path $repositoryRoot ".venv/toolchain/wasm-bindgen-$bindgenVersion"
$archiveName = "wasm-bindgen-$bindgenVersion-x86_64-pc-windows-msvc.tar.gz"
$bindgenExe = Join-Path $toolsRoot "wasm-bindgen-$bindgenVersion-x86_64-pc-windows-msvc/wasm-bindgen.exe"
if (!(Test-Path -LiteralPath $bindgenExe)) {
    New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
    $archive = Join-Path $toolsRoot $archiveName
    Invoke-WebRequest "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$bindgenVersion/$archiveName" -OutFile $archive
    $expected = '8fd8e2165da16b21ee3f5efd19e7f97d8d27cb7832f54edaef4b18e830283ec0'
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $expected) {
        throw 'Downloaded wasm-bindgen checksum mismatch.'
    }
    tar -xzf $archive -C $toolsRoot
    if ($LASTEXITCODE) { throw 'Unable to extract wasm-bindgen.' }
}
rustup target add wasm32-unknown-unknown
if ($LASTEXITCODE) { throw 'Unable to install the local WASM target.' }
$manifest = Join-Path $prototypeRoot 'rust/Cargo.toml'
cargo build --locked --release --target wasm32-unknown-unknown --lib --manifest-path $manifest
if ($LASTEXITCODE) { throw 'WASM build failed.' }
& $bindgenExe --target web --out-dir (Join-Path $prototypeRoot 'site/pkg') --out-name parser (Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown/release/semidata_web_parser.wasm')
if ($LASTEXITCODE) { throw 'WASM binding generation failed.' }
if (!$SkipNative) {
    cargo build --locked --release --bin native --manifest-path $manifest
    if ($LASTEXITCODE) { throw 'Native reference build failed.' }
}
Write-Output 'Browser assets are ready in web-prototype/site/pkg.'
