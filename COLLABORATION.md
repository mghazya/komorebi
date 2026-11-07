# Komorebi — Collaboration & Release Log

## Practice in Context: Beginner Packs 1–7 & Tap-to-Read Word Help

### Release Status
- **Overall Status**: **LIVE** (Verified on production GitHub Pages)
- **Live Production URL**: [https://mghazya.github.io/komorebi/](https://mghazya.github.io/komorebi/)
- **Live Asset Version Tag**: `?v=20261107-context-word-help`
- **Release Date**: 2026-11-07

---

### Releases & Merge Commits

1. **Pull Request #12: Beginner Packs 5–7 Release**
   - **PR**: [#12](https://github.com/mghazya/komorebi/pull/12)
   - **Branch**: `feat/practice-in-context-packs-5-7`
   - **Merge Commit**: [`c4ef262eddfe24a511eaef18629928c1b23abe90`](https://github.com/mghazya/komorebi/commit/c4ef262eddfe24a511eaef18629928c1b23abe90)
   - **Deployment Run**: GitHub Actions run `42341841442` (completed / success)
   - **Content Included**:
     - Beginner Pack 5: Actions (`で`), Accompaniment (`と`), Movement Origin (`から`)
     - Beginner Pack 6: Specific Time (`に`), Time/Space Span (`から…まで`), Polite Past (`〜ました / 〜ませんでした`)
     - Beginner Pack 7: Adjective Modifiers & Predicates (`い-adjectives`), Negative Forms (`〜くないです`), Clause Contrast (`…ですが、…`)
     - Family-reviewed Pack 7 revisions:
       - Room sentence: `この部屋は小さいですが、明るいです。` with contrast distractors `This room is small, but dark.` and `This room is large, but bright.`
       - Hotel sentence (follow-up): `このホテルは古いですが、きれいです。` with contrast distractors `This hotel is old, but dirty.` and `This hotel is new, but clean.`

2. **Pull Request #13: Tap-to-Read Word Help Across Packs 1–7**
   - **PR**: [#13](https://github.com/mghazya/komorebi/pull/13)
   - **Branch**: `feat/tap-to-read-word-help`
   - **Merge Commit**: [`9a542f737071bec4227139612cfe9c928b06cb7c`](https://github.com/mghazya/komorebi/commit/9a542f737071bec4227139612cfe9c928b06cb7c)
   - **Deployment Run**: GitHub Actions run `42342267856` (completed / success)
   - **Features & Fixes Included**:
     - Interactive word buttons across all primary and fresh follow-up sentences in Packs 1–7.
     - Context-specific kana, romaji, and short English glosses (reviewed word boundaries, compound kanji like `入り口`, contextual particles like `は` /wa/ and `を` /o/).
     - Stable inline word-help tray above choices, preventing choice displacement or layout jumping.
     - Answer selection preservation: opening or closing word help does not clear or reset selected choices.
     - Hidden cloze blanks: `（　）` rendered as non-interactive spans with zero answer leaking.
     - Responsive mobile layout verified at 360px viewport width and 200% font zoom (WCAG 1.4.4).
     - Full test suite passing (35 tests) and automated mechanical validation passing.

---

### Production Verification Evidence (Live Site)

All checks executed against `https://mghazya.github.io/komorebi/` using automated headless Chrome with an isolated, disposable guest profile:

1. **Asset Version Loading**:
   - `index.html` loads `<script src="./app.mjs?v=20261107-context-word-help">` and `<link href="./style.css?v=20261107-context-word-help">`.
   - 0 console errors recorded.
2. **Dashboard Pack Accessibility**:
   - All 7 Beginner Packs open cleanly from the dashboard (`pack:beginner-1` through `pack:beginner-7`).
3. **Tap-to-Read Interaction**:
   - Tapping `ふじ山` displays kana `ふじさん`, romaji `fujisan`, meaning `Mt. Fuji`.
   - Tapping particle `は` displays kana `わ`, romaji `wa`, meaning `topic marker`.
   - Close button `✕` restores the idle tray prompt without modifying the question state.
4. **Cloze Blank Secrecy**:
   - Verified on `ふじ山は（　）山です。`: `（　）` is a non-clickable text span, contains no word-help button, and does not leak the missing word (`高い`).
5. **Wrong-Answer Branching & Answer State Preservation**:
   - Deliberately choosing an incorrect answer renders explanatory feedback and unlocks "Try follow-up question".
   - Tapping word help while an answer is selected preserves the selected state (`aria-pressed="true"`, `.is-incorrect`).
   - Clicking follow-up opens a fresh sentence (`川の近くに（　）木があります。`), verifying distinct sentence requirement.
6. **SRS Schedule Invariance**:
   - Profile progress snapshot comparison before and after practice confirmed 0 changes to radical, kanji, or vocabulary SRS stages or review dates.
7. **Pack 7 Family-Reviewed Contrast Content**:
   - Live question confirmed: `この部屋は小さいですが、明るいです。` with three contrast choices testing both clauses.

---

### Grammar Coverage Summary

- **Total JLPT N5 Grammar IDs**: 69
- **Total JLPT N5 Distinct Meanings Tracked**: 147
- **Distinct Patterns Taught Across Packs 1–7**: 21 patterns (42 primary + 42 fresh follow-up questions)
- **Renshuu N5 Meanings Taught & Live**: 25 meanings (100% live in production)
- **Flagged Items & Uncertainty Notes**: 11 items preserved in `data/context-coverage-checklist.json`

---

### Remaining Limitations & Next Steps

1. **Uncovered N5 Grammar Meanings**:
   - 122 of 147 tracked N5 meanings remain in `planned` status.
   - Per project guidelines, no new packs were drafted or published during this release window.
2. **Flagged Items Awaiting Future Design**:
   - Overlapping direction particles (`へ` vs `に`): requires dedicated contrast notes before introducing `へ`.
   - Register-sensitive items (`わ`, abusive `が` 462#3): requires native language review or omission from beginner family content.
   - Polite past negative (`ではありませんでした` 743#2): planned for introduction in a subsequent pack paired with negative adjectives.
