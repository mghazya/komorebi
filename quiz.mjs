/**
 * Quiz queue and feedback helpers. Feedback after an answer reveals only what has already been
 * tested: the asked part, plus the other part of the same subject once its own question is no
 * longer waiting in the queue. This keeps a correct meaning from giving away the reading that is
 * asked next (and vice versa if the order is ever randomized).
 */
const readingsOf = (item) => (item.readings || []).map((r) => typeof r === 'string' ? r : r?.reading || r?.text || '').filter(Boolean);

export const hasReadingQuestion = (item) => item.type !== 'radical' && readingsOf(item).length > 0;
export const ACTIVE_REVIEW_POOL_SIZE = 10;

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function questionsForItem(item) {
  return [
    { id: item.id, kind: 'meaning' },
    ...(hasReadingQuestion(item) ? [{ id: item.id, kind: 'reading' }] : []),
  ];
}

export function buildQuizQueue(selected) {
  const queue = selected.flatMap((item) => questionsForItem(item));
  return shuffle(queue);
}

/** queue[0] is the question being answered. Returns which parts may be shown now. */
export function revealableParts(item, kind, queue) {
  const waiting = (other) => queue.slice(1).some((q) => q.id === item.id && q.kind === other);
  return {
    meaning: kind === 'meaning' || !waiting('meaning'),
    reading: hasReadingQuestion(item) && (kind === 'reading' || !waiting('reading')),
  };
}

/** Text for the feedback line. feedback: { correct, retry, message }. */
export function feedbackSummary(item, kind, feedback, queue) {
  if (feedback.retry) return feedback.message || 'Use the reading taught in the lesson.';
  if (!feedback.correct) return `Answer: ${kind === 'meaning' ? (item.meanings || [item.meaning]).join(' / ') : readingsOf(item).join(' / ')}`;
  const show = revealableParts(item, kind, queue);
  if (feedback.typo && feedback.matchedMeaning) {
    return `Accepted as “${feedback.matchedMeaning}” · ${[show.meaning ? item.meaning : '', show.reading ? readingsOf(item).join(' / ') : ''].filter(Boolean).join(' · ')}`;
  }
  return [show.meaning ? item.meaning : '', show.reading ? readingsOf(item).join(' / ') : ''].filter(Boolean).join(' · ');
}

/** Standard Levenshtein edit distance between two strings */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().replace(/\s+/g, ' ');

/** Detect if an answer was a near-miss typo for an accepted meaning */
function nearMissMeaning(item, answer) {
  const ans = norm(answer);
  if (!ans || ans.length < 3) return null;
  const accepted = [...(item.meanings || []), item.meaning].filter(Boolean).map(norm);
  let closest = null;
  let minDistance = Infinity;
  for (const m of accepted) {
    if (!m) continue;
    const dist = levenshtein(ans, m);
    if (dist > 0 && dist <= 2 && dist < minDistance) {
      minDistance = dist;
      closest = m;
    }
  }
  return closest ? { match: closest, distance: minDistance } : null;
}

/** Generate smart hint banners for post-answer feedback (WaniKani-style tooltips) */
export function hintBanners(item, kind, feedback) {
  if (!feedback || feedback.retry) return [];
  const banners = [];
  const meaningsCount = [...new Set([...(item.meanings || []), item.meaning].filter(Boolean))].length;

  if (feedback.correct) {
    if (feedback.typo && feedback.matchedMeaning) {
      banners.push(`Check your spelling: Correct spelling is “${feedback.matchedMeaning}”.`);
    } else if (kind === 'meaning' && meaningsCount > 1) {
      banners.push('Did you know this item has multiple possible meanings?');
    }
    if (kind === 'reading' && item.otherReadings?.length) {
      banners.push('This kanji has other readings you may encounter.');
    }
  } else {
    // Incorrect answer
    if (kind === 'meaning' && feedback.answer) {
      const near = nearMissMeaning(item, feedback.answer);
      if (near) {
        banners.push(`Almost! Did you mean “${near.match}”?`);
      }
    }
    banners.push(kind === 'meaning' ? 'Need help? View the correct meaning and mnemonic.' : 'Need help? View the correct reading and mnemonic.');
  }

  return banners;
}
