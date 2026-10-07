/**
 * Quiz queue and feedback helpers. Feedback after an answer reveals only what has already been
 * tested: the asked part, plus the other part of the same subject once its own question is no
 * longer waiting in the queue. This keeps a correct meaning from giving away the reading that is
 * asked next (and vice versa if the order is ever randomized).
 */
const readingsOf = (item) => (item.readings || []).map((r) => typeof r === 'string' ? r : r?.reading || r?.text || '').filter(Boolean);

export const hasReadingQuestion = (item) => item.type !== 'radical' && readingsOf(item).length > 0;

export function buildQuizQueue(selected) {
  return selected.flatMap((item) => [
    { id: item.id, kind: 'meaning' },
    ...(hasReadingQuestion(item) ? [{ id: item.id, kind: 'reading' }] : []),
  ]);
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
  return [show.meaning ? item.meaning : '', show.reading ? readingsOf(item).join(' / ') : ''].filter(Boolean).join(' · ');
}
