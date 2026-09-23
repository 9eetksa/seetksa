// Three identical strips keep native scrolling away from either physical end.
export function loopPosition(position, width) {
  if (width <= 0) return 0;
  return width + ((position - width) % width + width) % width;
}

export function mountPartnerReel(viewport, isPaused) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, frame = 0, last = 0, visible = false, drift = 0;
  let hovered = false, focused = false, pointer = null, resumeAt = 0;
  const cleanups = [];
  const listen = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    cleanups.push(() => target.removeEventListener(name, handler, options));
  };
  const wrap = () => {
    if (width && (viewport.scrollLeft < width || viewport.scrollLeft >= width * 2)) {
      viewport.scrollLeft = loopPosition(viewport.scrollLeft, width);
    }
  };
  const resize = new ResizeObserver(() => {
    const phase = width ? (viewport.scrollLeft - width) / width : 0;
    width = viewport.firstElementChild.getBoundingClientRect().width;
    viewport.scrollLeft = loopPosition(width * (1 + phase), width);
  });
  resize.observe(viewport);
  const tick = time => {
    const elapsed = last ? Math.min(time - last, 40) : 0;
    last = time;
    if (!motion.matches && !isPaused() && !hovered && !focused && !pointer && time >= resumeAt) {
      drift += elapsed * .032;
      const pixels = Math.floor(drift);
      drift -= pixels;
      viewport.scrollLeft += pixels;
      wrap();
    }
    frame = requestAnimationFrame(tick);
  };
  const run = () => {
    cancelAnimationFrame(frame);
    last = 0;
    if (visible && !document.hidden) frame = requestAnimationFrame(tick);
  };
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; run(); });
  observer.observe(viewport);
  listen(document, 'visibilitychange', run);
  listen(viewport, 'scroll', wrap, {passive:true});
  listen(viewport, 'pointerenter', event => { if (event.pointerType === 'mouse') hovered = true; });
  listen(viewport, 'pointerleave', () => { hovered = false; });
  listen(viewport, 'focusin', () => { focused = viewport.matches(':focus-visible'); });
  listen(viewport, 'focusout', () => { focused = false; });
  listen(viewport, 'pointerdown', event => {
    if (event.button !== 0) return;
    pointer = {id:event.pointerId, x:event.clientX, mouse:event.pointerType === 'mouse'};
    if (pointer.mouse) viewport.setPointerCapture(event.pointerId);
  });
  listen(viewport, 'pointermove', event => {
    if (!pointer?.mouse || pointer.id !== event.pointerId) return;
    viewport.scrollLeft -= event.clientX - pointer.x;
    pointer.x = event.clientX;
    wrap();
  });
  const release = () => { pointer = null; resumeAt = performance.now() + 1800; };
  for (const name of ['pointerup','pointercancel','lostpointercapture']) listen(viewport, name, release);
  listen(viewport, 'wheel', () => { resumeAt = performance.now() + 1800; }, {passive:true});
  listen(viewport, 'keydown', event => {
    if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    focused = true;
    event.preventDefault();
    viewport.scrollLeft += (event.key === 'ArrowRight' ? 1 : -1) * width / viewport.firstElementChild.children.length;
    wrap();
  });
  return () => { cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); cleanups.forEach(fn => fn()); };
}
