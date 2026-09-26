// Package tracked application assets and explicitly named local runtime builds.
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '..'), site = join(root, 'site'), dist = join(root, 'dist'), output = join(dist, 'pages');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const source = `https://github.com/aj9696/STDF-Viewer/tree/${revision}`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expected = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const assets = git('ls-files', '-z', '--', 'web-prototype/site').split('\0').filter(Boolean)
  .map((name) => name.slice('web-prototype/site/'.length));

for (const directory of ['sqlite', 'vendor']) {
  const manifest = JSON.parse(await readFile(join(site, directory, 'manifest.json'), 'utf8'));
  const dependencies = directory === 'sqlite' ? [{ name: manifest.package, version: manifest.version }] : manifest.dependencies;
  for (const dependency of dependencies) {
    if (dependency.version !== (expected.dependencies[dependency.name] ?? expected.devDependencies[dependency.name])) {
      throw Error(`Rebuild ${directory}: ${dependency.name} differs from package.json.`);
    }
  }
  for (const [name, info] of Object.entries(manifest.files)) {
    if (name.includes('/') || name.includes('\\') || name === '..') throw Error(`Invalid runtime manifest path: ${name}`);
    const bytes = await readFile(join(site, directory, name));
    if (bytes.length !== info.bytes || sha256(bytes) !== info.sha256) throw Error(`Rebuild ${directory}: ${name} failed its manifest check.`);
    assets.push(`${directory}/${name}`);
  }
  assets.push(`${directory}/manifest.json`);
}
assets.push('pkg/parser.js', 'pkg/parser_bg.wasm');
for (const name of ['pkg/parser_bg.wasm', 'sqlite/sqlite3.wasm']) {
  if (!WebAssembly.validate(await readFile(join(site, name)))) throw Error(`Invalid WASM binary: ${name}`);
}

// Include license texts from the exact offline Cargo graph, including build tools.
// The repository-local toolchain is optional when Cargo is already configured.
const localCargo = join(repo, '.venv', 'toolchain', 'cargo');
const useLocalCargo = !process.env.CARGO_HOME && existsSync(join(localCargo, 'bin', 'cargo.exe'));
const cargoEnvironment = useLocalCargo ? { ...process.env, CARGO_HOME: localCargo, RUSTUP_HOME: join(repo, '.venv', 'toolchain', 'rustup') } : process.env;
const cargo = useLocalCargo ? join(localCargo, 'bin', 'cargo.exe') : 'cargo';
const metadata = JSON.parse(execFileSync(cargo, ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', 'wasm32-unknown-unknown', '--manifest-path', join(root, 'rust', 'Cargo.toml')], { env: cargoEnvironment, encoding: 'utf8' }));
let rustNotices = 'SemiData Rust/WASM dependency notices\n\nExact packages from Cargo.lock; includes compile-time dependencies.\n';
for (const dependency of metadata.packages.filter((item) => item.source).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))) {
  let directory = dirname(dependency.manifest_path);
  let licenses = (await readdir(directory)).filter((name) => /^(LICENSE|COPYING|NOTICE)([.-]|$)/i.test(name)).sort();
  rustNotices += `\n\nDependency: ${dependency.name} ${dependency.version}\nLicense: ${dependency.license}\nSource: ${dependency.repository ?? dependency.source}\n`;
  if (dependency.name === 'rust-stdf-derive' && !licenses.length) {
    const parent = metadata.packages.find((item) => item.name === 'rust-stdf' && item.version === dependency.version && item.repository === dependency.repository);
    if (!parent) throw Error('Cannot locate rust-stdf-derive project license.');
    directory = dirname(parent.manifest_path);
    licenses = ['LICENSE'];
    rustNotices += 'The macro crate omits a license file; the same-version rust-stdf project MIT license follows.\n';
  }
  if (!licenses.length) throw Error(`Missing license text for ${dependency.name}.`);
  for (const name of licenses) rustNotices += `\n--- ${name} ---\n${await readFile(join(directory, name), 'utf8')}\n`;
}

// Resolve and check the fixed generated directory before replacing it. Never
// follow a user-created directory link into a different part of the filesystem.
await mkdir(dist, { recursive: true });
if (await realpath(dist) !== join(await realpath(root), 'dist')) throw Error('dist must be a real directory inside web-prototype.');
try {
  if ((await lstat(output)).isSymbolicLink()) throw Error('Refusing to replace a linked pages directory.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const name of new Set(assets)) {
  const input = join(site, name);
  if (!(await lstat(input)).isFile()) throw Error(`Expected a regular application file: ${name}`);
  await mkdir(dirname(join(output, name)), { recursive: true });
  await copyFile(input, join(output, name));
}
await copyFile(join(site, 'index.html'), join(output, 'parser.html'));
await copyFile(join(site, 'app.html'), join(output, 'index.html'));
await copyFile(join(repo, 'LICENSE'), join(output, 'LICENSE.txt'));
await writeFile(join(output, 'THIRD-PARTY-RUST-NOTICES.txt'), rustNotices);
await writeFile(join(output, 'NOTICE.txt'), `SemiData browser STDF workbench\n\nModified from STDF-Viewer by noonchen and contributors.\nUpstream: https://github.com/noonchen/STDF-Viewer\nApplication license: GNU GPL version 3 (LICENSE.txt).\nCorresponding source and build instructions: ${source}\n\nDependency license texts:\n  sqlite/NOTICE.txt\n  vendor/NOTICE.txt\n  THIRD-PARTY-RUST-NOTICES.txt\n`);
await writeFile(join(output, '_headers'), '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n');
await writeFile(join(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found · SemiData</title><h1>Page not found</h1><p><a href="/">Open SemiData</a></p></html>\n');
const files = {};
async function inventory(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await inventory(join(directory, entry.name), `${name}/`);
    else { const bytes = await readFile(join(directory, entry.name)); files[name] = { bytes: bytes.length, sha256: sha256(bytes) }; }
  }
}
await inventory(output);
if (Object.values(files).some((info) => info.bytes > 25 * 1024 * 1024)) throw Error('A packaged asset exceeds the Pages 25 MiB limit.');
const release = { revision, source, sourceDirty: Boolean(git('status', '--porcelain', '--untracked-files=no')), files };
const releaseText = JSON.stringify(release, null, 2) + '\n';
await writeFile(join(output, 'release.json'), releaseText);
console.log(JSON.stringify({ output, revision, sourceDirty: release.sourceDirty, files: Object.keys(files).length + 1, bytes: Object.values(files).reduce((sum, info) => sum + info.bytes, Buffer.byteLength(releaseText)) }, null, 2));
