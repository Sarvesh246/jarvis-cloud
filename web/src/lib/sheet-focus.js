const sheets = [];
const candidates = 'a[href],area[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable="true"]';

function tabStops(panel) {
  return [...panel.querySelectorAll(candidates)]
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') &&
      !el.closest('[inert],[hidden]') && el.getClientRects().length &&
      getComputedStyle(el).visibility !== 'hidden')
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

// A sheet may open another sheet. Only the most recently opened one owns focus.
export function containSheetFocus(panel, onClose) {
  const previous = document.activeElement;
  const entry = { panel };
  sheets.push(entry);
  function active() {
    const native = document.querySelector('dialog[open]');
    return sheets.at(-1) === entry && !native;
  }
  function focusInside(event) {
    if (active() && !panel.contains(event.target)) panel.focus({ preventScroll: true });
  }
  function keys(event) {
    if (!active() || event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      const stops = tabStops(panel);
      const at = stops.indexOf(document.activeElement);
      if (!stops.length || at < 0 || (event.shiftKey ? at === 0 : at === stops.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? stops.at(-1) : stops[0])?.focus({ preventScroll: true });
        if (!stops.length) panel.focus({ preventScroll: true });
      }
    }
  }
  document.addEventListener('keydown', keys);
  document.addEventListener('focusin', focusInside);
  if (active()) panel.focus({ preventScroll: true });
  return () => {
    const owned = sheets.at(-1) === entry;
    sheets.splice(sheets.indexOf(entry), 1);
    document.removeEventListener('keydown', keys);
    document.removeEventListener('focusin', focusInside);
    if (owned && !document.querySelector('dialog[open]') && previous?.isConnected &&
        (document.activeElement === document.body || panel.contains(document.activeElement))) {
      previous.focus?.({ preventScroll: true });
    }
  };
}
