import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const source = new URL("node_modules/@sqlite.org/sqlite-wasm/", root);
const target = new URL("site/sqlite/", root);
const metadata = JSON.parse(await readFile(new URL("package.json", source), "utf8"));
const expected = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if (metadata.version !== expected.dependencies["@sqlite.org/sqlite-wasm"]) {
  throw new Error("SQLite version differs from the pinned dependency; run npm ci --ignore-scripts.");
}
await mkdir(target, { recursive: true });
const files = {};
for (const name of ["index.mjs", "sqlite3.wasm", "sqlite3-opfs-async-proxy.js"]) {
  const input = new URL(`dist/${name}`, source);
  await copyFile(input, new URL(name, target));
  const bytes = await readFile(input);
  files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
// Preserve the upstream embedded SQLite/Emscripten license verbatim as well as
// in the copied bundle. npm package metadata declares Apache-2.0 for its wrapper.
const bundle = await readFile(new URL("index.mjs", target), "utf8");
const licenseStart = bundle.indexOf("/* @preserve");
const licenseEnd = bundle.indexOf("*/", licenseStart) + 2;
if (licenseStart < 0 || licenseEnd < 2) throw new Error("Upstream license notice missing.");
await writeFile(new URL("NOTICE.txt", target),
  `@sqlite.org/sqlite-wasm ${metadata.version}\nhttps://github.com/sqlite/sqlite-wasm\n` +
  `Package license: ${metadata.license}\n\n${bundle.slice(licenseStart, licenseEnd)}\n`);
const manifest = { package: metadata.name, version: metadata.version, files };
await writeFile(new URL("manifest.json", target), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
