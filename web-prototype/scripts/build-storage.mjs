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
// Keep the upstream banner intact and distribute the full pinned license texts.
const bundle = await readFile(new URL("index.mjs", target), "utf8");
const licenseStart = bundle.indexOf("/* @preserve");
const licenseEnd = bundle.indexOf("*/", licenseStart) + 2;
if (licenseStart < 0 || licenseEnd < 2) throw new Error("Upstream license notice missing.");
const noticesSource = new URL("THIRD-PARTY-NOTICES.txt", root);
const notices = await readFile(noticesSource);
const noticesText = notices.toString("utf8");
if (!noticesText.includes(`Dependency: ${metadata.name} ${metadata.version}`) ||
    !noticesText.includes(bundle.slice(licenseStart, licenseEnd))) {
  throw new Error("Third-party notices do not match the pinned SQLite distribution.");
}
await copyFile(noticesSource, new URL("NOTICE.txt", target));
files["NOTICE.txt"] = {
  bytes: notices.length,
  sha256: createHash("sha256").update(notices).digest("hex"),
};
const manifest = { package: metadata.name, version: metadata.version, files };
await writeFile(new URL("manifest.json", target), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
