import type { DrawerContext, DrawerContextId, XTerminal } from '../types'

/**
 * Watch `document.title` and OSC 7777 escape sequences to switch
 * the active drawer context automatically.
 */
export function setupAutoDetect(
	term: XTerminal,
	contexts: readonly DrawerContext[],
	setContext: (id: DrawerContextId) => void,
): void {
	const fallbackId = contexts[0]?.id
	const contextIds = new Set(contexts.map((c) => c.id))

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

	// OSC 7777 detection (explicit signal from tmux bindings via DCS passthrough)
	if (term.parser) {
		term.parser.registerOscHandler(7777, (data: string) => {
			const id = data.trim()
			if (id && contextIds.has(id)) {
				setContext(id)
			} else if (fallbackId) {
				matchTitle()
			}
			return true
		})
	}

	// Run once on init
	matchTitle()
}
