/**
 * Keep the quiz inside the visible area when a phone keyboard opens.
 * index.html asks for `interactive-widget=resizes-content`, so Android Chrome 108+ and Firefox shrink
 * the layout viewport and the fixed quiz simply fits. Browsers that ignore it (older Chrome, iOS Safari)
 * keep the old "resizes-visual" behaviour: only the visual viewport shrinks and may pan; we then follow
 * visualViewport.height/offsetTop. Values are applied immediately (no frame where the glyph sits
 * off-screen) and again on the next frame, after the browser has finished its own adjustments.
 */
export function quizViewport(viewport, windowHeight) {
  return { height: Math.max(160, viewport?.height || windowHeight), top: Math.max(0, viewport?.offsetTop || 0) };
}
export function installQuizViewport(win = window, doc = document) {
  let frame;
  const apply = () => {
    const box = quizViewport(win.visualViewport, win.innerHeight);
    const root = doc.documentElement.style;
    root.setProperty('--quiz-viewport-height', `${box.height}px`);
    root.setProperty('--quiz-viewport-top', `${box.top}px`);
  };
  const update = () => {
    apply();
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(apply);
  };
  win.visualViewport?.addEventListener('resize', update);
  win.visualViewport?.addEventListener('scroll', update);
  win.addEventListener('resize', update);
  doc.addEventListener('focusin', update);
  doc.addEventListener('focusout', update);
  update();
  return update;
}
