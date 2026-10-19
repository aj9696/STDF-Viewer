# Bundled typefaces

IBM Plex Sans (Regular, Medium, SemiBold) and IBM Plex Mono (Regular, Medium).
Unmodified complete WOFF2 files from [IBM/plex](https://github.com/IBM/plex/tree/71f558992315a12ca1f06a2215d57962a1992162), revision `71f558992315a12ca1f06a2215d57962a1992162`.

Source paths: `packages/plex-sans/fonts/complete/woff2/` and `packages/plex-mono/fonts/complete/woff2/`.
The accompanying `LICENSE.txt` is the upstream SIL Open Font License 1.1.
Fonts are served from this application’s origin. No font CDN or third-party runtime request is used.
Unsupported scripts fall back to the browser's installed system fonts.

`fonts.css` maps weights above 600 to the bundled Sans SemiBold and above 500 to Mono Medium rather than synthesizing bold. Font settings in existing workspaces remain authoritative.
