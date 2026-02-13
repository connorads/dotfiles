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
	let activeContextId: DrawerContextId = contexts[0]?.id ?? 'tmux'

	// Hide tab bar when only 1 context
	if (contexts.length <= 1) {
		tabs.style.display = 'none'
	}

	function renderTabs(): void {
		tabs.innerHTML = ''
		for (const ctx of contexts) {
			const tabBtn = el('button')
			tabBtn.textContent = ctx.label
			if (ctx.id === activeContextId) {
				tabBtn.classList.add('active')
			}
			tabBtn.addEventListener('click', (e: Event) => {
				e.preventDefault()
				haptic()
				setContext(ctx.id)
			})
			tabs.appendChild(tabBtn)
		}
	}

	function renderGrid(): void {
		grid.innerHTML = ''
		const ctx = contexts.find((c) => c.id === activeContextId)
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

	function setContext(id: DrawerContextId): void {
		activeContextId = id
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
