/** BB 0.45 lets macOS Option+G reach the new-thread editor as ©. */
export function mountComposerShortcut(win: Window, subject: () => string | null, open: (subject: string) => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.code !== 'KeyG' && event.key !== '©') return;
    const current = subject();
    if (!current) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) open(current);
  };
  win.addEventListener('keydown', onKeyDown, true);
  return () => win.removeEventListener('keydown', onKeyDown, true);
}
