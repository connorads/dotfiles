import { describe, expect, test } from 'bun:test'
import { clampFontSize, touchDistance } from '../src/gestures/pinch'
import { isValidSwipe } from '../src/gestures/swipe'

describe('isValidSwipe', () => {
	const config = { enabled: true, threshold: 80, maxDuration: 400 }

	test('detects right swipe', () => {
		expect(isValidSwipe(100, 10, 200, config)).toBe('right')
	})

	test('detects left swipe', () => {
		expect(isValidSwipe(-100, 10, 200, config)).toBe('left')
	})

	test('rejects swipe below threshold', () => {
		expect(isValidSwipe(50, 10, 200, config)).toBeNull()
	})

	test('rejects swipe that takes too long', () => {
		expect(isValidSwipe(100, 10, 500, config)).toBeNull()
	})

	test('rejects diagonal swipe (dy too large)', () => {
		expect(isValidSwipe(100, 80, 200, config)).toBeNull()
	})

	test('handles zero duration', () => {
		expect(isValidSwipe(100, 0, 0, config)).toBe('right')
	})

	test('respects custom threshold', () => {
		const strict = { enabled: true, threshold: 200, maxDuration: 400 }
		expect(isValidSwipe(150, 10, 200, strict)).toBeNull()
		expect(isValidSwipe(250, 10, 200, strict)).toBe('right')
	})
})

describe('touchDistance', () => {
	test('calculates distance between two points', () => {
		const d = touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })
		expect(d).toBe(5)
	})

	test('handles same point', () => {
		const d = touchDistance({ clientX: 10, clientY: 20 }, { clientX: 10, clientY: 20 })
		expect(d).toBe(0)
	})

	test('handles negative coordinates', () => {
		const d = touchDistance({ clientX: -3, clientY: 0 }, { clientX: 0, clientY: 4 })
		expect(d).toBe(5)
	})
})

describe('clampFontSize', () => {
	test('clamps to minimum', () => {
		expect(clampFontSize(4, [8, 32])).toBe(8)
	})

	test('clamps to maximum', () => {
		expect(clampFontSize(40, [8, 32])).toBe(32)
	})

	test('passes through values in range', () => {
		expect(clampFontSize(16, [8, 32])).toBe(16)
	})

	test('handles boundary values', () => {
		expect(clampFontSize(8, [8, 32])).toBe(8)
		expect(clampFontSize(32, [8, 32])).toBe(32)
	})
})
