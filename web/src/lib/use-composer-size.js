import { useCallback, useEffect, useLayoutEffect } from 'react';

const nativeSizing = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

export function useComposerSize(textarea, draft, phone) {
  const fit = useCallback(() => {
    const el = textarea.current;
    if (!el) return;
    // Older engines still need measurement. Preserve a scrolled long draft
    // and coalesce multiple edits into the next frame before measuring it.
    const top = el.scrollTop;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, phone ? 132 : 208)}px`;
    el.scrollTop = top;
  }, [textarea, phone]);

  useLayoutEffect(() => {
    if (nativeSizing) return;
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [draft, fit]);

  useEffect(() => {
    const el = textarea.current;
    if (nativeSizing || !el) return;
    let width = el.getBoundingClientRect().width;
    let frame = 0, active = true;
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(entries => {
      const next = entries[0].contentRect.width;
      if (next !== width) { width = next; queue(); }
    });
    observer.observe(el);
    document.fonts?.ready.then(() => { if (active) queue(); });
    window.addEventListener('resize', queue);
    return () => {
      active = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', queue);
    };
  }, [fit]);

  return nativeSizing;
}
