// Focus moves queued by rendering or async work must not override later user
// intent, even if focus subsequently returns to the original control.
export function createFocusOwnership(document) {
  let revision = 0, disposed = false;
  const tokens = new Set();
  const onFocus = event => {
    if (event.target !== document.body && event.target !== document.documentElement) { revision++; tokens.clear(); }
  };
  const onIntent = event => { if (event.isTrusted) { revision++; tokens.clear(); } };
  const onFocusOut = event => {
    for (const token of tokens) if (event.target === token.origin && unavailable(token.origin)) token.released = true;
  };
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('pointerdown', onIntent, true);
  document.addEventListener('keydown', onIntent, true);

  function unavailable(element) {
    if (!element || !element.isConnected) return true;
    if (element.matches?.(':disabled') || element.closest?.('[hidden], [inert]')) return true;
    if (element.getClientRects && element.getClientRects().length === 0) return true;
    const style = document.defaultView?.getComputedStyle?.(element);
    return style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.display === 'none';
  }
  return {
    capture() { const token = { origin: document.activeElement, revision, released: false }; tokens.add(token); return token; },
    focus(token, target) {
      if (disposed || !token || !tokens.delete(token) || token.revision !== revision || !document.hasFocus() || unavailable(target)) return false;
      const active = document.activeElement;
      if (active !== token.origin && !(active === document.body && (token.released || unavailable(token.origin)))) return false;
      target.focus();
      return document.activeElement === target;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      tokens.clear();
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', onIntent, true);
      document.removeEventListener('keydown', onIntent, true);
    }
  };
}

// Only the latest async generation may supply or clear its focus token.
export function createFocusOperationSlot() {
  let current = null;
  return {
    begin(token) { current = { token }; return current; },
    current() { return current?.token ?? null; },
    end(operation) { if (current === operation) current = null; }
  };
}
