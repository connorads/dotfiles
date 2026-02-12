import type { DrawerCommand, XTerminal } from '../types'
import { el } from '../util/dom'
import { haptic } from '../util/haptic'
import { sendData } from '../util/terminal'

export interface DrawerResult {
	readonly backdrop: HTMLDivElement
	readonly drawer: HTMLDivElement
	readonly open: () => void
	readonly close: () => void
	readonly isOpen: () => boolean
}

/** Create the tmux command drawer with backdrop */
export function createDrawer(term: XTerminal, commands: readonly DrawerCommand[]): DrawerResult {
	const backdrop = el('div', { id: 'wt-backdrop' })
	const drawer = el('div', { id: 'wt-drawer' })
	const handle = el('div', { id: 'wt-drawer-handle' })
	const grid = el('div', { id: 'wt-drawer-grid' })

	drawer.appendChild(handle)
	drawer.appendChild(grid)

	let drawerOpen = false

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

	// Wire command buttons
	for (const cmd of commands) {
		const button = el('button')
		button.textContent = cmd.label
		button.addEventListener('click', (e: Event) => {
			e.preventDefault()
			haptic()
			close()
			sendData(term, cmd.seq)
			term.focus()
		})
		grid.appendChild(button)
	}

	// Backdrop dismisses drawer
	backdrop.addEventListener('click', () => {
		haptic()
		close()
		term.focus()
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
			const dy = touch.clientY - handleStartY
			drawer.style.transform = ''
			if (dy > 60) {
				close()
				term.focus()
			}
		},
		{ passive: true },
	)

	return { backdrop, drawer, open, close, isOpen }
}
