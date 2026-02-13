import type { DrawerContext, DrawerContextId } from '../types'

/**
 * Watch `document.title` and switch the active drawer context
 * when the title matches a context's `titlePatterns`.
 */
export function setupAutoDetect(
	contexts: readonly DrawerContext[],
	setContext: (id: DrawerContextId) => void,
): void {
	const fallbackId = contexts[0]?.id

	function matchTitle(): void {
		const title = document.title.toLowerCase()

		for (const ctx of contexts) {
			if (!ctx.titlePatterns) continue
			for (const pattern of ctx.titlePatterns) {
				if (title.includes(pattern.toLowerCase())) {
					setContext(ctx.id)
					return
				}
			}
		}

		// No match — fall back to first context
		if (fallbackId) {
			setContext(fallbackId)
		}
	}

	// Observe <title> text changes via MutationObserver
	const titleEl = document.querySelector('title')
	if (titleEl) {
		const observer = new MutationObserver(matchTitle)
		observer.observe(titleEl, { childList: true, characterData: true, subtree: true })
	}

	// Run once on init
	matchTitle()
}
