import type { Reply } from './contracts.ts';

export type ChoicePicker = {
  root: HTMLElement;
  key: string;
  currentKey(): string | null;
  choose(number: number): Promise<Reply>;
};
export type ChoiceCapture =
  | { ok: false; reason: string }
  | {
      ok: true;
      kind: 'question' | 'picker';
      apply(number: number): Promise<Reply>;
      submit(): Promise<Reply>;
    };

const paneSelector = '[data-split-pane-id][data-focused]';
const blockedSelector = '[hidden],[inert],[aria-hidden="true"],[data-state="closed"]';

function visible(node: HTMLElement): boolean {
  if (!node.isConnected || node.closest(blockedSelector)) return false;
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden') return false;
  }
  return node.getClientRects().length > 0;
}

function focusedPath(node: Element): boolean {
  for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.matches(paneSelector) && ancestor.getAttribute('data-focused') === 'false') return false;
  }
  return true;
}

function meaningfulText(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('kbd,[aria-hidden="true"]').forEach((child) => child.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function controls(group: HTMLFieldSetElement): HTMLButtonElement[] {
  return Array.from(group.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
}

function fingerprint(group: HTMLFieldSetElement): string {
  const legend = group.querySelector(':scope > legend');
  if (!legend) return 'missing-question';
  return JSON.stringify([meaningfulText(legend), ...controls(group).map(meaningfulText)]);
}

export function blockingSurface(document: Document, picker?: ChoicePicker, monitor?: HTMLElement): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"],[aria-modal="true"],[data-promptbox-typeahead-menu],[role="listbox"],[role="menu"]',
    ),
  ).some((node) => visible(node) && !picker?.root.contains(node) && node !== picker?.root && node !== monitor);
}

function questionGroups(document: Document): HTMLFieldSetElement[] {
  const active = document.activeElement;
  const activePane = active?.closest(paneSelector);
  if (activePane && !focusedPath(activePane)) return [];
  const root = activePane ?? document;
  return Array.from(root.querySelectorAll<HTMLFieldSetElement>('fieldset')).filter(
    (group) =>
      visible(group) &&
      focusedPath(group) &&
      group.querySelector(':scope > legend') &&
      (controls(group).length > 0 || group.querySelector('textarea')) &&
      (!activePane || group.closest(paneSelector) === activePane),
  );
}

export function captureChoice(
  document: Document,
  context: () => string,
  picker?: ChoicePicker,
  monitor?: HTMLElement,
): ChoiceCapture {
  if (!document.hasFocus()) return { ok: false, reason: 'BB lost focus.' };
  if (blockingSurface(document, picker, monitor)) return { ok: false, reason: 'Close the unrelated popup first.' };
  const initialContext = context();
  let consumed = false;
  const once = async (run: () => Promise<Reply>): Promise<Reply> => {
    if (consumed) return { ok: false, outcome: 'error', message: 'This recording was already handled.' };
    consumed = true;
    if (!document.hasFocus() || context() !== initialContext || blockingSurface(document, picker, monitor)) {
      return { ok: false, outcome: 'error', message: 'The target changed. Record the command again.' };
    }
    return run();
  };
  if (picker && visible(picker.root)) {
    return {
      ok: true,
      kind: 'picker',
      submit: () => once(async () => ({ ok: false, outcome: 'error', message: 'Close the voice choices before submitting an answer.' })),
      apply: (number) =>
        once(async () => {
          if (!visible(picker.root) || picker.currentKey() !== picker.key) {
            return { ok: false, outcome: 'error', message: 'The voice choices changed.' };
          }
          return picker.choose(number);
        }),
    };
  }
  const groups = questionGroups(document);
  if (groups.length !== 1)
    return { ok: false, reason: groups.length ? 'The question target is ambiguous.' : 'There is no active question.' };
  const group = groups[0];
  if (group.disabled) return { ok: false, reason: 'The question is disabled.' };
  const roster = controls(group);
  const identity = fingerprint(group);
  const answers = () => JSON.stringify([controls(group).map(button => button.getAttribute('aria-pressed')),
    Array.from(group.querySelectorAll('textarea')).map(input => input.value)]);
  const initialAnswers = answers();
  const unchanged = () => {
    const currentGroups = questionGroups(document);
    const currentRoster = controls(group);
    return visible(group) && focusedPath(group) && currentGroups.length === 1 && currentGroups[0] === group
      && identity === fingerprint(group) && roster.length === currentRoster.length
      && roster.every((button, index) => button === currentRoster[index]);
  };
  return {
    ok: true,
    kind: 'question',
    submit: () => once(async () => {
      if (!unchanged() || answers() !== initialAnswers) return { ok: false, outcome: 'error', message: 'The question or answer changed. Record the command again.' };
      const root = group.closest<HTMLElement>('div[tabindex="-1"]');
      const buttons = root ? Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
        .filter(button => visible(button) && /^(submit answers?|next)$/i.test(meaningfulText(button))) : [];
      const button = buttons.length === 1 ? buttons[0] : undefined;
      if (!button || group.disabled || button.matches(':disabled') || button.closest('[aria-disabled="true"]')) {
        return { ok: false, outcome: 'error', message: 'Answer submission is unavailable. Complete the current answer first.' };
      }
      const next = meaningfulText(button).toLowerCase() === 'next';
      root?.focus();
      button.click();
      const deadline = performance.now() + 500;
      while (performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
        if (!root?.isConnected || !group.isConnected) return { ok: true, outcome: 'completed', message: next ? 'Next question ready.' : 'Answer submitted.' };
      }
      return { ok: true, outcome: 'requested', message: 'Answer submission requested. Check the question for errors.' };
    }),
    apply: (number) =>
      once(async () => {
        if (!unchanged()) {
          return { ok: false, outcome: 'error', message: 'The question changed. Record the command again.' };
        }
        const button = Number.isSafeInteger(number) && number > 0 ? roster[number - 1] : undefined;
        if (!button || !visible(button) || button.matches(':disabled') || button.closest('[aria-disabled="true"]')) {
          return { ok: false, outcome: 'error', message: 'That answer is unavailable.' };
        }
        const before = button.getAttribute('aria-pressed');
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const otherInput = group.querySelector<HTMLTextAreaElement>('textarea');
        if (button === roster.at(-1) && otherInput) otherInput.focus();
        else group.closest<HTMLElement>('div[tabindex="-1"]')?.focus();
        const deadline = performance.now() + 500;
        while (performance.now() < deadline) {
          if (!group.isConnected || !button.isConnected)
            return { ok: false, outcome: 'error', message: 'The question disappeared after activation.' };
          const after = button.getAttribute('aria-pressed');
          if (after !== before || after === 'true') {
            return {
              ok: true,
              outcome: 'completed',
              message: `${after === 'true' ? 'Selected' : 'Cleared'} ${meaningfulText(button)}.`,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return { ok: false, outcome: 'error', message: 'No answer change was observed.' };
      }),
  };
}


// A question page replaces its fieldset; finishing removes the owning form.
export function watchQuestionFocus(document: Document, context: () => string, focusComposer: () => void): () => void {
  let owner: { root: HTMLElement; pane: Element | null; context: string } | null = null;
  const remember = () => {
    const active = document.activeElement;
    const root = active?.closest<HTMLElement>('div[tabindex="-1"]');
    const group = root?.querySelector<HTMLFieldSetElement>('fieldset');
    owner = root && group?.querySelector(':scope > legend') && (controls(group).length || group.querySelector('textarea'))
      ? { root, pane: root.closest(paneSelector), context: context() } : null;
  };
  const forget = () => { owner = null; };
  const observer = new MutationObserver(() => {
    if (!owner || owner.root.isConnected) return;
    const previous = owner;
    owner = null;
    if (!document.hasFocus() || context() !== previous.context || document.activeElement !== document.body) return;
    if (previous.pane && (!previous.pane.isConnected || !focusedPath(previous.pane))) return;
    if (blockingSurface(document) || questionGroups(document).length) return;
    focusComposer();
  });
  remember();
  const pointer = (event: Event) => {
    if (owner && event.target instanceof Node && !owner.root.contains(event.target)) forget();
  };
  document.addEventListener('focusin', remember);
  document.addEventListener('pointerdown', pointer);
  document.defaultView?.addEventListener('blur', forget);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', remember);
    document.removeEventListener('pointerdown', pointer);
    document.defaultView?.removeEventListener('blur', forget);
    owner = null;
  };
}
