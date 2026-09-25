import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const target = new URL("site/vendor/", root);
const expected = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const names = ["seek-bzip", "@zip.js/zip.js", "fzstd", "hash-wasm", "pako", "esbuild"];
const dependencies = [];
let notices = "SemiData browser compression dependencies\n\nGenerated from the exact npm packages pinned in package-lock.json.\n";
for (const name of names) {
  const path = new URL(`node_modules/${name}/`, root);
  const metadata = JSON.parse(await readFile(new URL("package.json", path), "utf8"));
  if (metadata.version !== (expected.dependencies[name] ?? expected.devDependencies[name])) {
    throw new Error(`Unexpected ${name} version; run npm ci --ignore-scripts.`);
  }
  const license = await readFile(new URL(name === "esbuild" ? "LICENSE.md" : "LICENSE", path), "utf8");
  dependencies.push({ name, version: metadata.version, license: metadata.license, buildOnly: name === "esbuild" });
  notices += `\n\nDependency: ${name} ${metadata.version}${name === "esbuild" ? " (build only)" : ""}\n${license}\n`;
}
const pakoMap = JSON.parse(await readFile(new URL("node_modules/pako/dist/pako.mjs.map", root), "utf8"));
const pakoSource = pakoMap.sourcesContent[pakoMap.sources.findIndex((name) => name.endsWith("/zlib/inflate.mjs"))];
if (!pakoSource?.includes("This notice may not be removed")) throw new Error("Pako zlib license notice is missing.");
notices += "\n\nPako zlib-derived decoder:\n" + pakoSource.slice(0, pakoSource.indexOf("\nimport ")) + "\n";
notices += "\nseek-bzip uses a small browser Uint8Array adapter instead of Node Buffer.\n" +
  "The application's asynchronous BZIP2 block drain is adapted from seek-bzip's MIT-licensed _read_bunzip.\n" +
  "hash-wasm xxhash64.c: Copyright (c) 2016 Stephan Brumme. All rights reserved.\n" +
  "Modified for hash-wasm by Dani Biró. Based on Yann Collet's XXHash descriptions.\n" +
  "Upstream terms: https://create.stephan-brumme.com/disclaimer.html (checked 2026-09-25).\n" +
  "This software is provided 'as-is', without any express or implied warranty. In no event will the author be held liable for any damages arising from the use of this software.\n" +
  "Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:\n" +
  "1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software.\n" +
  "2. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.\n" +
  "3. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.\n";
await mkdir(target, { recursive: true });
const result = await build({
  absWorkingDir: fileURLToPath(root), bundle: true, platform: "browser", format: "esm", target: "es2022",
  write: false, minify: true, legalComments: "inline", treeShaking: true,
  stdin: { resolveDir: fileURLToPath(root), contents: `
    import Bunzip from 'seek-bzip';
    export { Bunzip };
    export { BlobReader, ZipReader, configure } from '@zip.js/zip.js/lib/zip-core.js';
    export { Crc32 } from './node_modules/@zip.js/zip.js/lib/core/streams/codecs/crc32.js';
    export { Decompress as ZstdDecoder } from 'fzstd';
    export { createXXHash64 } from 'hash-wasm';
    export { ZStream, zlibInflateInit2, zlibInflate, zlibInflateEnd, zlibInflateReset } from 'pako';
  ` },
  banner: { js: `// Pinned local dependencies. Full licenses: ./NOTICE.txt; hashes: ./manifest.json\n` +
    `var Buffer = class extends Uint8Array { copy(target,start=0,from=0,to=this.length){target.set(this.subarray(from,to),start);} toString(encoding){if(encoding!=='hex')throw Error('Unsupported Buffer encoding');return Array.from(this,b=>b.toString(16).padStart(2,'0')).join('');} };` },
});
await writeFile(new URL("compression.js", target), result.outputFiles[0].contents);
await writeFile(new URL("NOTICE.txt", target), notices);
await writeFile(new URL("THIRD-PARTY-VIEWER-NOTICES.txt", root), notices);
const files = {};
for (const name of ["compression.js", "NOTICE.txt"]) {
  const bytes = await readFile(new URL(name, target));
  files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
const manifest = { dependencies, files };
await writeFile(new URL("manifest.json", target), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest));
