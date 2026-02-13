import type { DrawerContext, DrawerContextId, XTerminal } from '../types'
import { el } from '../util/dom'
import { haptic } from '../util/haptic'
import { conditionalFocus, isKeyboardOpen } from '../util/keyboard'
import { sendData } from '../util/terminal'

export interface DrawerResult {
	readonly backdrop: HTMLDivElement
	readonly drawer: HTMLDivElement
	readonly open: () => void
	readonly close: () => void
	readonly isOpen: () => boolean
	readonly setContext: (id: DrawerContextId) => void
	readonly openTo: (id: DrawerContextId) => void
}

/** Create the multi-context command drawer with backdrop and tab bar */
export function createDrawer(term: XTerminal, contexts: readonly DrawerContext[]): DrawerResult {
	const backdrop = el('div', { id: 'wt-backdrop' })
	const drawer = el('div', { id: 'wt-drawer' })
	const handle = el('div', { id: 'wt-drawer-handle' })
	const tabs = el('div', { id: 'wt-drawer-tabs' })
	const grid = el('div', { id: 'wt-drawer-grid' })

	drawer.appendChild(handle)
	drawer.appendChild(tabs)
	drawer.appendChild(grid)

	let drawerOpen = false
	/** Set by auto-detect only — drives tab visibility and toolbar row2 */
	let detectedId: DrawerContextId = contexts[0]?.id ?? 'tmux'
	/** Set by auto-detect OR tab click — drives tab highlight and grid content */
	let activeId: DrawerContextId = detectedId

	/** Contexts visible given the current detected context */
	function visibleContexts(): readonly DrawerContext[] {
		const seen = new Set<DrawerContextId>()
		const result: DrawerContext[] = []
		for (const ctx of contexts) {
			if (!ctx.titlePatterns || ctx.id === detectedId) {
				if (!seen.has(ctx.id)) {
					seen.add(ctx.id)
					result.push(ctx)
				}
			}
		}
		return result
	}

	function renderTabs(): void {
		tabs.innerHTML = ''
		const visible = visibleContexts()
		tabs.style.display = visible.length <= 1 ? 'none' : ''
		for (const ctx of visible) {
			const tabBtn = el('button')
			tabBtn.textContent = ctx.label
			if (ctx.id === activeId) {
				tabBtn.classList.add('active')
			}
			tabBtn.addEventListener('click', (e: Event) => {
				e.preventDefault()
				haptic()
				selectContext(ctx.id)
			})
			tabs.appendChild(tabBtn)
		}
	}

	function renderGrid(): void {
		grid.innerHTML = ''
		const ctx = contexts.find((c) => c.id === activeId)
		if (!ctx) return

		for (const cmd of ctx.commands) {
			const button = el('button')
			button.textContent = cmd.label
			button.addEventListener('click', (e: Event) => {
				e.preventDefault()
				const kbWasOpen = isKeyboardOpen()
				haptic()
				close()
				sendData(term, cmd.seq)
				conditionalFocus(term, kbWasOpen)
			})
			grid.appendChild(button)
		}
	}

	function open(): void {
		backdrop.style.display = 'block'
		drawer.classList.add('open')
		drawerOpen = true
	}

	function close(): void {
		drawer.classList.remove('open')
		backdrop.style.display = 'none'
		drawerOpen = false
	}

	function isOpen(): boolean {
		return drawerOpen
	}

	/** Tab click — only updates activeId, not tab visibility */
	function selectContext(id: DrawerContextId): void {
		activeId = id
		renderTabs()
		renderGrid()
	}

	/** Auto-detect — updates both detectedId and activeId */
	function setContext(id: DrawerContextId): void {
		detectedId = id
		activeId = id
		renderTabs()
		renderGrid()
	}

	function openTo(id: DrawerContextId): void {
		setContext(id)
		open()
	}

	// Backdrop dismisses drawer
	backdrop.addEventListener('click', () => {
		const kbWasOpen = isKeyboardOpen()
		haptic()
		close()
		conditionalFocus(term, kbWasOpen)
	})

	// Swipe-to-dismiss on handle
	let handleStartY = 0

	handle.addEventListener(
		'touchstart',
		(e: TouchEvent) => {
			const touch = e.touches[0]
			if (touch) handleStartY = touch.clientY
		},
		{ passive: true },
	)

	handle.addEventListener(
		'touchmove',
		(e: TouchEvent) => {
			const touch = e.touches[0]
			if (!touch) return
			const dy = touch.clientY - handleStartY
			if (dy > 0) drawer.style.transform = `translateY(${dy}px)`
		},
		{ passive: true },
	)

	handle.addEventListener(
		'touchend',
		(e: TouchEvent) => {
			const touch = e.changedTouches[0]
			if (!touch) return
			const kbWasOpen = isKeyboardOpen()
			const dy = touch.clientY - handleStartY
			drawer.style.transform = ''
			if (dy > 60) {
				close()
				conditionalFocus(term, kbWasOpen)
			}
		},
		{ passive: true },
	)

	// Initial render
	renderTabs()
	renderGrid()

	return { backdrop, drawer, open, close, isOpen, setContext, openTo }
}
