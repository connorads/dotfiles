import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { setupAutoDetect } from '../src/drawer/auto-detect'
import type { DrawerContext, XTerminal } from '../src/types'

const tmuxContext: DrawerContext = {
	id: 'tmux',
	label: 'tmux',
	commands: [],
}

const lazygitContext: DrawerContext = {
	id: 'lazygit',
	label: 'lazygit',
	commands: [],
	titlePatterns: ['lazygit'],
}

const claudeContext: DrawerContext = {
	id: 'claude',
	label: 'claude',
	commands: [],
	titlePatterns: ['claude'],
}

const contexts: readonly DrawerContext[] = [tmuxContext, lazygitContext, claudeContext]

/** Minimal mock terminal without parser support */
const noParserTerm: XTerminal = {
	options: { fontSize: 14 },
	input() {},
	focus() {},
	onData() {
		return { dispose() {} }
	},
}

/** Mock terminal with parser that captures OSC handler registrations */
function mockTermWithParser(): {
	term: XTerminal
	fireOsc: (ident: number, data: string) => boolean
} {
	const handlers = new Map<number, (data: string) => boolean>()
	return {
		term: {
			options: { fontSize: 14 },
			input() {},
			focus() {},
			onData() {
				return { dispose() {} }
			},
			parser: {
				registerOscHandler(ident: number, callback: (data: string) => boolean) {
					handlers.set(ident, callback)
					return { dispose() {} }
				},
			},
		},
		fireOsc(ident: number, data: string): boolean {
			const handler = handlers.get(ident)
			return handler ? handler(data) : false
		},
	}
}

beforeEach(() => {
	GlobalRegistrator.register()
})

afterEach(() => {
	GlobalRegistrator.unregister()
})

describe('setupAutoDetect', () => {
	test('calls setContext with matching context on init', () => {
		document.title = 'claude code - project'
		let lastContextId = ''
		setupAutoDetect(noParserTerm, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('claude')
	})

	test('falls back to first context when no match', () => {
		document.title = 'bash - terminal'
		let lastContextId = ''
		setupAutoDetect(noParserTerm, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('tmux')
	})

	test('matches case-insensitively', () => {
		document.title = 'CLAUDE Code'
		let lastContextId = ''
		setupAutoDetect(noParserTerm, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('claude')
	})

	test('matches lazygit title', () => {
		document.title = 'lazygit'
		let lastContextId = ''
		setupAutoDetect(noParserTerm, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('lazygit')
	})

	test('falls back for empty title', () => {
		document.title = ''
		let lastContextId = ''
		setupAutoDetect(noParserTerm, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('tmux')
	})

	test('OSC 7777 switches to known context', () => {
		document.title = 'bash - terminal'
		const { term, fireOsc } = mockTermWithParser()
		let lastContextId = ''
		setupAutoDetect(term, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('tmux') // initial fallback

		fireOsc(7777, 'lazygit')
		expect(lastContextId).toBe('lazygit')
	})

	test('OSC 7777 with empty payload falls back to title match', () => {
		document.title = 'claude code - project'
		const { term, fireOsc } = mockTermWithParser()
		let lastContextId = ''
		setupAutoDetect(term, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('claude') // initial title match

		fireOsc(7777, 'lazygit')
		expect(lastContextId).toBe('lazygit')

		fireOsc(7777, '')
		expect(lastContextId).toBe('claude') // re-evaluated from title
	})

	test('OSC 7777 with unknown id falls back to title match', () => {
		document.title = 'bash - terminal'
		const { term, fireOsc } = mockTermWithParser()
		let lastContextId = ''
		setupAutoDetect(term, contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('tmux')

		fireOsc(7777, 'unknown-context')
		expect(lastContextId).toBe('tmux') // fallback via matchTitle
	})

	test('OSC 7777 handler returns true', () => {
		document.title = ''
		const { term, fireOsc } = mockTermWithParser()
		setupAutoDetect(term, contexts, () => {})

		const result = fireOsc(7777, 'lazygit')
		expect(result).toBe(true)
	})
})
