# Viewer help

The **Help** button opens a panel from the right. It opens the topic for the
current view or engineering tool. **Column help** in Statistics opens the
statistics definitions. The Topic list also gives access to every view, all
fifteen engineering tools, selection rules, and workspace transfer.
**Yield help** opens the Yield Manager topic, including its yield denominator,
recorded-time axis, missing data and source-group replacement rules.

The help is local. Opening it makes no network request and reads no source data.
It does not start a calculation or change the viewer selection. Help remains in
English when the navigation language changes; the dialog declares `lang="en"`.

## Interaction and accessibility

- The native modal dialog keeps the viewer behind the panel inactive.
- The topic heading receives focus when the panel opens. Tab moves to Close.
- Tab and Shift+Tab stay within the panel. All actions have visible labels.
- Escape or Close dismisses the panel and restores focus to its opening control.
- Topic changes preserve focus on the Topic selector. Related-topic buttons move
  focus to the new heading.
- The text scrolls within the panel. The Topic selector and Close remain visible.
- The panel is 496 px wide on desktop and fills narrower screens. Controls have
  at least 44 px height on phones. Reduced-motion preference removes its animation.

The panel continues the existing framed-sheet design, semantic colors, and font
preferences. It adds no new design direction, decorative imagery, or chart colors.
Its question is: “What does this view do, and how do I interpret its result?”

## Controlled-English policy

The content follows an ASD-STE100-oriented editorial policy. The reference is
[ASD-STE100 Issue 9, dated January 15, 2025](https://asd-ste100.org/).
The [official standard](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)
contains the authoritative rules and dictionary. The
[STEMG explanation of checking tools](https://asd-ste100.org/STEsoftware.html)
explains why automated checks require terminology and linguistic review.

Apply these rules when a topic changes:

1. Use active instructions with one action per step.
2. Keep procedural sentences at 20 words or fewer.
3. Keep descriptive sentences at 25 words or fewer.
4. Use the same term for the same object or action.
5. Use complete sentences and American English. Do not use contractions.
6. Keep an exact control label when the procedure refers to that control.
7. Define technical nouns and abbreviations in the topic or the terms topic.
8. Explain eligibility, unknown outcomes, and unavailable values separately.
9. Describe the implemented method and its limits. Do not imply proprietary
   equivalence, process qualification, or statistical guarantees.

The content is reviewed for short sentences, terminology, and implementation
accuracy. It has **not** received a complete approved-dictionary, part-of-speech,
and meaning audit. Do not label the help certified or fully ASD-STE100 compliant.
The sentence-length check is an editorial guard, not a conformance checker.

The topic text is original product documentation. The repository does not bundle
the copyrighted standard or its dictionary.

## Files and integration

- `site/viewer-help-content.js` contains topic data and the topic lookup map.
- `site/viewer-help.js` creates the dialog and handles focus and navigation.
- `site/viewer-help.css` contains the panel layout and motion rules.

`installViewerHelp({getTopic})` returns `{open(topic?), close(), destroy()}`.
`getTopic` supplies a viewer tab ID or study tool ID when `open()` has no argument.
An unknown ID falls back to File info. The optional reference IDs are `scope`,
`workspace`, and `terms`. Install once per viewer instance.

Content is rendered with `textContent`; it cannot supply HTML or executable
markup. The help module does not import the analysis provider or data client.
Keep its tab and tool IDs aligned with the viewer when adding or renaming tools.

## Verification

Run the isolated browser check from the repository root:

```powershell
node web-prototype/scripts/viewer-help-check.mjs chrome
node web-prototype/scripts/viewer-help-check.mjs msedge
```

The check covers topic IDs and related links, conservative sentence lengths,
context selection, keyboard navigation, modal isolation, close and Escape focus
restoration, narrow layouts, scrolling, reduced motion, and browser errors. It
uses an isolated browser profile and a local HTTP fixture. It does not open the
engineer's library or use an authenticated browser profile.

When a tool changes, compare its help against the source and the corresponding
method document. Current references include [tools](TOOLS.md),
[study methods](STUDIES-METHODS.md), [wafer studies](WAFER-STUDIES.md),
[authoring](AUTHORING.md), and [workspace transfer](VIEWER-TRANSFER.md).
