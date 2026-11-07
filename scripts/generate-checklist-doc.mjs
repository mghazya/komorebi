import fs from 'node:fs';
import path from 'node:path';

const CHECKLIST_JSON_PATH = path.resolve('data/context-coverage-checklist.json');
const CHECKLIST_MD_PATH = path.resolve('docs/CONTEXT_COVERAGE_CHECKLIST.md');

const data = JSON.parse(fs.readFileSync(CHECKLIST_JSON_PATH, 'utf8'));

const lines = [];

lines.push('# Komorebi Practice in Context — Grammar Coverage Checklist');
lines.push('');
lines.push('- **Tracking Granularity**: Tracked by `(renshuuGrammarId, meaningIndex)` (`renshuu:<id>#<idx>`) because a single Renshuu grammar ID can cover multiple distinct meanings/uses (e.g., `113` `に` has 9 uses; `132` `の` has 6 uses).');
lines.push('- **Taught Rule**: A grammar meaning is counted as `taught: true` **only** when it has validated primary and distinct follow-up exercises testing it in a pack.');
lines.push('- **Status Lifecycle**: `planned` → `draft` → `validated` → `reviewed` → `live`.');
lines.push('- **Source & Licensing Policy**: The local Renshuu exports are used strictly as a local planning reference. All published explanations, example sentences, glosses, distractors, follow-ups, and worked examples in `data/context-pack-*.json` are original material authored for Komorebi. Raw exports are never uploaded.');
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(`- **Total JLPT N5 Grammar IDs**: ${data.summary.totalN5GrammarIds}`);
lines.push(`- **Total JLPT N5 Distinct Meanings Tracked**: ${data.summary.totalN5Meanings}`);
lines.push(`- **Distinct Patterns Taught Across Packs 1–7**: ${data.summary.distinctPatternsTaught} patterns (42 primary questions + 42 fresh follow-up questions)`);
lines.push(`- **Renshuu N5 Meanings Taught (` + '`taught: true`' + `)**: ${data.summary.taughtMeaningsCount} (` +
  `\`live\`: ${data.summary.byStatus.live || 0}, ` +
  `\`reviewed\`: ${data.summary.byStatus.reviewed || 0}, ` +
  `\`validated\`: ${data.summary.byStatus.validated || 0}, ` +
  `\`planned\`: ${data.summary.byStatus.planned || 0})`);
lines.push(`- **Flagged Items Requiring Review / Disambiguation**: ${data.entries.filter((e) => e.flags?.length).length}`);
lines.push('');
lines.push('## Active & Validated Beginner Packs (Packs 1–7)');
lines.push('');
lines.push('| Pack ID | Title | Subtitle | Status | Patterns (`grammar:*`) | Renshuu Meanings Taught | Questions |');
lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

for (const pack of data.packs) {
  const patternsStr = pack.patterns.map((p) => `\`${p}\``).join(', ');
  const taughtMeanings = data.entries
    .filter((e) => e.packId === pack.packId)
    .map((e) => `\`${e.meaningId}\``)
    .join(', ');
  lines.push(`| \`${pack.packId}\` | ${pack.title} | ${pack.subtitle} | \`${pack.status}\` | ${patternsStr} | ${taughtMeanings} | ${pack.questionsCount} primary + ${pack.followUpsCount} follow-up |`);
}

lines.push('');
lines.push('## Flagged Items & Uncertainty Log');
lines.push('');
lines.push('| Meaning ID | Title | Status | Flag / Uncertainty Note |');
lines.push('| :--- | :--- | :--- | :--- |');

const flagged = data.entries.filter((e) => e.flags && e.flags.length);
for (const item of flagged) {
  for (const flag of item.flags) {
    lines.push(`| \`${item.meaningId}\` | ${item.title} | \`${item.status}\` | ${flag.replace(/\|/g, '\\|')} |`);
  }
}

lines.push('');
lines.push(`## Full N5 Grammar Meaning Checklist (${data.entries.length} Meanings)`);
lines.push('');
lines.push('| Meaning ID | Title | Meaning / Use | Prerequisites | Linked Komorebi Words | Pack ID | Pattern ID | Exercises | Taught | Status |');
lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

for (const e of data.entries) {
  const prereqs = e.prerequisites?.length ? e.prerequisites.map((p) => `\`${p}\``).join(', ') : '—';
  const linked = e.linkedWords?.length ? e.linkedWords.join(', ') : '—';
  const pack = e.packId ? `\`${e.packId}\`` : '—';
  const pattern = e.patternId ? `\`${e.patternId}\`` : '—';
  const exercises = e.exerciseIds?.length ? e.exerciseIds.length : 0;
  const taught = e.taught ? 'Yes' : 'No';
  lines.push(`| \`${e.meaningId}\` | ${e.title} | ${e.meaning.replace(/\|/g, '\\|')} | ${prereqs} | ${linked} | ${pack} | ${pattern} | ${exercises} | ${taught} | \`${e.status}\` |`);
}

lines.push('');

fs.writeFileSync(CHECKLIST_MD_PATH, lines.join('\n'));
console.log('Successfully generated docs/CONTEXT_COVERAGE_CHECKLIST.md');
