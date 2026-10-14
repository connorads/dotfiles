import { definePluginApp, experimental_copyToClipboard } from '@get-bb/plugin-sdk/app';
import { findTerminal, tweak } from './xterm.ts';

const writeClipboard = (text: string) => { void experimental_copyToClipboard({ text }); };

export default definePluginApp(app => {
  app.contentScripts.register({
    id: 'kitty-like-terminal',
    mount({ signal }) {
      const tweaked = new Map<HTMLElement, () => void>();

      const scan = () => {
        for (const [element, restore] of tweaked) {
          if (!element.isConnected) { restore(); tweaked.delete(element); }
        }
        for (const element of document.querySelectorAll<HTMLElement>('.xterm')) {
          if (tweaked.has(element)) continue;
          const term = findTerminal(element);
          if (term) tweaked.set(element, tweak(term, writeClipboard));
        }
      };

      const observer = new MutationObserver(scan);
      observer.observe(document.body, { childList: true, subtree: true });
      scan();

      const clear = () => {
        observer.disconnect();
        for (const restore of tweaked.values()) restore();
        tweaked.clear();
      };
      signal.addEventListener('abort', clear, { once: true });
      return clear;
    },
  });
});
