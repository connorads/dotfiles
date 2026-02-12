import type { FontConfig, XTerminal } from '../types'
import { resizeTerm } from '../util/terminal'

/** Calculate distance between two touch points */
export function touchDistance(
	t1: { clientX: number; clientY: number },
	t2: { clientX: number; clientY: number },
): number {
	const dx = t1.clientX - t2.clientX
	const dy = t1.clientY - t2.clientY
	return Math.sqrt(dx * dx + dy * dy)
}

/** Clamp font size to configured range */
export function clampFontSize(size: number, range: readonly [number, number]): number {
	return Math.max(range[0], Math.min(range[1], size))
}

/** Attach pinch-to-zoom gesture to the xterm screen */
export function attachPinchGestures(term: XTerminal, font: FontConfig): void {
	let pinchStartDist = 0
	let pinchBaseFontSize = 0

	function onPinchStart(e: TouchEvent): void {
		if (e.touches.length === 2) {
			const t0 = e.touches[0]
			const t1 = e.touches[1]
			if (!t0 || !t1) return
			pinchStartDist = touchDistance(t0, t1)
			pinchBaseFontSize = term.options.fontSize
		}
	}

	function onPinchMove(e: TouchEvent): void {
		if (e.touches.length === 2) {
			e.preventDefault()
			if (pinchStartDist === 0) return
			const t0 = e.touches[0]
			const t1 = e.touches[1]
			if (!t0 || !t1) return
			const dist = touchDistance(t0, t1)
			const ratio = dist / pinchStartDist
			const newSize = clampFontSize(Math.round(pinchBaseFontSize * ratio), font.sizeRange)
			if (newSize !== term.options.fontSize) {
				term.options.fontSize = newSize
				resizeTerm()
			}
		}
	}

	// Wait for .xterm-screen then attach
	function attach(): void {
		const screen = document.querySelector('.xterm-screen')
		if (!screen) {
			setTimeout(attach, 200)
			return
		}
		screen.addEventListener('touchstart', (e: Event) => onPinchStart(e as TouchEvent), {
			passive: true,
		})
		screen.addEventListener('touchmove', (e: Event) => onPinchMove(e as TouchEvent), {
			passive: false,
		})
	}

	attach()
}
