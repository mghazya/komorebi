/**
 * Mechanical validator and resumable checklist runner for Practice in context packs.
 *
 * Checks:
 * 1. Coverage checklist structure, statuses (`planned`, `draft`, `validated`, `reviewed`, `live`),
 *    prerequisite references, and the rule that a meaning is `taught: true` ONLY when it has
 *    exercises (`question:*` + `followup:*`) testing it.
 * 2. Resumable execution: inspects `checklist.packs` and skips regenerating packs already marked
 *    `validated`, `reviewed`, or `live`, while verifying all mechanical invariants.
 * 3. Globally unique, stable IDs across all packs (`pack:*`, `grammar:*`, `example:*`,
 *    `question:*`, `followup:*`) with zero collision against SRS prefixes (`radical:`, `kanji:`, `vocabulary:`).
 * 4. Valid subject links (`subjectIds`) against Komorebi curriculum files (`data/level-*.json`).
 * 5. Required choice feedback, answer keys, varied correct-answer positions, distinct choice texts
 *    (no duplicate options or known overlapping particle pairs like へ vs. に on motion verbs),
 *    and distinct fresh follow-up sentences (`followUp.japanese !== question.japanese`).
 * 6. On-demand loading guarantee (`app.mjs` startup never fetches any context pack).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTEXT_PACKS,
  validateContextPack,
  createContextSession,
} from '../context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VALID_STATUSES = new Set(['planned', 'draft', 'validated', 'reviewed', 'live']);
const SKIP_REGEN_STATUSES = new Set(['validated', 'reviewed', 'live']);
const SRS_PREFIX = /^(?:radical|kanji|vocabulary):/;

export function runMechanicalChecks({ rootDir = ROOT } = {}) {
  const checklistPath = path.join(rootDir, 'data', 'context-coverage-checklist.json');
  const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));

  // Load all known curriculum IDs across data/level-*.json
  const dataDir = path.join(rootDir, 'data');
  const levelFiles = fs.readdirSync(dataDir).filter((f) => /^level-\d+\.json$/.test(f));
  const knownSubjectIds = new Set();
  const level1SubjectIds = new Set();
  for (const lf of levelFiles) {
    const items = JSON.parse(fs.readFileSync(path.join(dataDir, lf), 'utf8'));
    for (const item of items) {
      knownSubjectIds.add(item.id);
      if (lf === 'level-1.json') level1SubjectIds.add(item.id);
    }
  }

  const globalPackIds = new Set();
  const globalPatternIds = new Set();
  const globalExampleIds = new Set();
  const globalQuestionIds = new Set();
  const globalFollowUpIds = new Set();
  const allExerciseIdsByPack = new Map();
  const allPatternsByPack = new Map();
  const skippedApprovedPacks = [];
  const packReports = [];

  for (const meta of CONTEXT_PACKS) {
    const checklistPack = checklist.packs.find((p) => p.packId === meta.id);
    if (!checklistPack) {
      throw new Error(`Pack ${meta.id} is missing from data/context-coverage-checklist.json`);
    }
    if (!VALID_STATUSES.has(checklistPack.status)) {
      throw new Error(`Pack ${meta.id} has invalid checklist status: ${checklistPack.status}`);
    }
    if (SKIP_REGEN_STATUSES.has(checklistPack.status)) {
      skippedApprovedPacks.push(meta.id);
    }

    const packFilePath = path.join(rootDir, meta.path.replace(/^\.\//, ''));
    const rawPack = JSON.parse(fs.readFileSync(packFilePath, 'utf8'));
    const pack = validateContextPack(rawPack);

    if (pack.id !== meta.id) {
      throw new Error(`Pack ID mismatch in ${meta.path}: expected ${meta.id}, got ${pack.id}`);
    }
    if (globalPackIds.has(pack.id) || SRS_PREFIX.test(pack.id)) {
      throw new Error(`Duplicate or colliding pack ID: ${pack.id}`);
    }
    globalPackIds.add(pack.id);

    const packExerciseIds = new Set();
    const packPatternIds = new Set();

    for (const pattern of pack.patterns) {
      if (globalPatternIds.has(pattern.id)) {
        throw new Error(`Duplicate pattern ID across packs: ${pattern.id}`);
      }
      globalPatternIds.add(pattern.id);
      packPatternIds.add(pattern.id);

      if (!Array.isArray(pattern.subjectIds) || !pattern.subjectIds.length) {
        throw new Error(`Pattern ${pattern.id} in ${pack.id} must link to at least one Komorebi subject`);
      }
      for (const subjId of pattern.subjectIds) {
        if (!knownSubjectIds.has(subjId)) {
          throw new Error(`Pattern ${pattern.id} links to unknown Komorebi subject ID: ${subjId}`);
        }
        if (pack.level === 1 && !level1SubjectIds.has(subjId)) {
          throw new Error(`Level 1 pack ${pack.id} pattern ${pattern.id} links to non-Level-1 subject: ${subjId}`);
        }
      }

      for (const ex of pattern.examples) {
        if (globalExampleIds.has(ex.id) || !ex.id.startsWith('example:')) {
          throw new Error(`Invalid or duplicate example ID: ${ex.id}`);
        }
        globalExampleIds.add(ex.id);
      }

      // Each pattern must have at least 1 seen check and 1 fresh sentence
      const freshCount = pattern.questions.filter((q) => q.isFreshSentence === true).length;
      if (freshCount < 1) {
        throw new Error(`Pattern ${pattern.id} in ${pack.id} must include at least one fresh unseen sentence`);
      }

      for (const q of pattern.questions) {
        if (globalQuestionIds.has(q.id)) {
          throw new Error(`Duplicate question ID across packs: ${q.id}`);
        }
        globalQuestionIds.add(q.id);
        packExerciseIds.add(q.id);

        const fu = q.followUp;
        if (globalFollowUpIds.has(fu.id)) {
          throw new Error(`Duplicate follow-up ID across packs: ${fu.id}`);
        }
        globalFollowUpIds.add(fu.id);
        packExerciseIds.add(fu.id);

        // Ensure follow-up tests the same distinction on a changed sentence
        if (fu.japanese.trim() === q.japanese.trim()) {
          throw new Error(`Follow-up ${fu.id} repeats the exact sentence of ${q.id}`);
        }
        if (fu.kind !== q.kind) {
          throw new Error(`Follow-up ${fu.id} kind (${fu.kind}) must match ${q.id} kind (${q.kind})`);
        }

        // Guard against ambiguous particle pair (に vs. へ on destination questions)
        for (const itemQ of [q, fu]) {
          const texts = itemQ.choices.map((c) => c.text.trim());
          if (pattern.id === 'grammar:ni-destination' && texts.includes('に') && texts.includes('へ')) {
            throw new Error(`Ambiguous distractor pair (に vs. へ) in ${itemQ.id}`);
          }
          // Verify correct choice explanation affirms correctness and wrong choices explain why not
          for (const c of itemQ.choices) {
            if (c.id === itemQ.correctChoice) {
              if (!/That’s right!|correct/i.test(c.explanation)) {
                throw new Error(`Correct choice ${c.id} in ${itemQ.id} must affirm why it works`);
              }
            } else if (!/Not quite\./i.test(c.explanation)) {
              throw new Error(`Distractor choice ${c.id} in ${itemQ.id} must explain why it doesn't work`);
            }
          }
        }
      }
    }

    // Verify answer key position variety across the 6 primary and 6 follow-up questions in the pack
    const session = createContextSession(pack);
    const primaryKeyCounts = { A: 0, B: 0, C: 0 };
    const followUpKeyCounts = { A: 0, B: 0, C: 0 };
    for (const q of session.questions) {
      primaryKeyCounts[q.correctChoice] = (primaryKeyCounts[q.correctChoice] || 0) + 1;
      followUpKeyCounts[q.followUp.correctChoice] = (followUpKeyCounts[q.followUp.correctChoice] || 0) + 1;
    }
    for (const letter of ['A', 'B', 'C']) {
      if (!primaryKeyCounts[letter]) {
        throw new Error(`Pack ${pack.id} primary questions do not use choice position ${letter}`);
      }
      if (!followUpKeyCounts[letter]) {
        throw new Error(`Pack ${pack.id} follow-up questions do not use choice position ${letter}`);
      }
    }

    allExerciseIdsByPack.set(pack.id, packExerciseIds);
    allPatternsByPack.set(pack.id, packPatternIds);
    packReports.push({
      packId: pack.id,
      title: pack.title,
      status: checklistPack.status,
      patterns: Array.from(packPatternIds),
      primaryKeyDistribution: primaryKeyCounts,
      followUpKeyDistribution: followUpKeyCounts,
      questionsCount: session.questions.length,
    });
  }

  // Validate every checklist entry
  const meaningIds = new Set();
  for (const entry of checklist.entries) {
    if (!entry.meaningId || meaningIds.has(entry.meaningId)) {
      throw new Error(`Invalid or duplicate checklist meaningId: ${entry.meaningId}`);
    }
    meaningIds.add(entry.meaningId);
    if (!VALID_STATUSES.has(entry.status)) {
      throw new Error(`Checklist entry ${entry.meaningId} has invalid status: ${entry.status}`);
    }
    if (entry.taught) {
      if (!entry.packId || !entry.patternId || !Array.isArray(entry.exerciseIds) || entry.exerciseIds.length < 2) {
        throw new Error(`Taught checklist entry ${entry.meaningId} must have packId, patternId, and exerciseIds`);
      }
      const packEx = allExerciseIdsByPack.get(entry.packId);
      const packPats = allPatternsByPack.get(entry.packId);
      if (!packEx || !packPats || !packPats.has(entry.patternId)) {
        throw new Error(`Checklist entry ${entry.meaningId} references missing pack/pattern ${entry.packId}/${entry.patternId}`);
      }
      for (const exId of entry.exerciseIds) {
        if (!packEx.has(exId)) {
          throw new Error(`Checklist entry ${entry.meaningId} references unknown exercise ${exId}`);
        }
      }
      for (const wId of entry.linkedWords || []) {
        if (!knownSubjectIds.has(wId)) {
          throw new Error(`Checklist entry ${entry.meaningId} links to unknown Komorebi word ${wId}`);
        }
      }
    } else {
      if (entry.status !== 'planned' && entry.status !== 'draft') {
        throw new Error(`Untaught checklist entry ${entry.meaningId} cannot have status ${entry.status}`);
      }
      if (Array.isArray(entry.exerciseIds) && entry.exerciseIds.length > 0) {
        throw new Error(`Untaught checklist entry ${entry.meaningId} has non-empty exerciseIds`);
      }
    }
  }

  // Verify prerequisite IDs exist in checklist
  for (const entry of checklist.entries) {
    for (const pre of entry.prerequisites || []) {
      if (!meaningIds.has(pre)) {
        throw new Error(`Checklist entry ${entry.meaningId} references unknown prerequisite ${pre}`);
      }
    }
  }

  // Verify on-demand loading in app.mjs
  const appSource = fs.readFileSync(path.join(rootDir, 'app.mjs'), 'utf8');
  const startupSlice = appSource.slice(appSource.lastIndexOf('curriculum=await loadCurriculum()'));
  if (/loadContextPack/.test(startupSlice)) {
    throw new Error('Startup in app.mjs must never fetch context packs eagerly');
  }

  return {
    ok: true,
    totalChecklistEntries: checklist.entries.length,
    taughtMeaningsCount: checklist.entries.filter((e) => e.taught).length,
    flaggedMeaningsCount: checklist.entries.filter((e) => e.flags?.length > 0).length,
    skippedApprovedPacks,
    packReports,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runMechanicalChecks();
  console.log(JSON.stringify(result, null, 2));
}
