export function mountMobileHomeSpacing(doc: Document): () => void {
  const style = doc.createElement('style');
  style.textContent = `
    [data-testid="root-compose-compact-home"] > [data-testid="root-compose-compact-scroll-viewport"] {
      top: 56px !important;
    }
    [data-testid="root-compose-compact-home"] [data-testid="root-compose-compact-scroll-content"] {
      justify-content: flex-start !important;
    }
    [data-testid="root-compose-compact-home"] [data-testid="root-compose-compact-recents-offset"] {
      display: none !important;
    }
  `;
  doc.head.append(style);
  return () => style.remove();
}
