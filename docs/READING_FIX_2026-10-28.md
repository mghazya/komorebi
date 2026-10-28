# Reading question fix — 2026-10-28

Quiz headings and accessible input labels now state on’yomi, kun’yomi, or nanori, based on the accepted lesson readings and the existing typed reading dataset. Vocabulary asks for the whole word. Known alternative kanji readings use both otherReadings and the typed dataset and trigger a no-penalty retry. Incorrect vocabulary readings remain incorrect. No progress migration or schedule changes.

Corrected five reading-type mapping errors against official pages:
- https://www.wanikani.com/kanji/叔 — お is nanori.
- https://www.wanikani.com/kanji/谷 — や is kun’yomi.
- https://www.wanikani.com/kanji/暴 — ばく is on’yomi.
- https://www.wanikani.com/kanji/納 — なっ is on’yomi.
- https://www.wanikani.com/kanji/丼 — どん and どんぶり are kun’yomi.

Validation: node --test tests/*.test.mjs (20 passed). Includes all 2,101 kanji: taught readings remain accepted, each has a type label, and mapped alternatives retry. Actual submit handler tested in review, lesson, practice and placement: alternative readings do not increment mistakes/answers or save progress. Unknown readings still fail; no broad prefix matching or guessed readings.

Limit: alternative coverage is bounded by the curriculum and existing typed dataset; this is not an exhaustive Japanese dictionary. The remaining typed entries were checked for internal consistency, not individually re-verified against external sources.
