import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { setupAutoDetect } from '../src/drawer/auto-detect'
import type { DrawerContext } from '../src/types'

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
		setupAutoDetect(contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('claude')
	})

	test('falls back to first context when no match', () => {
		document.title = 'bash - terminal'
		let lastContextId = ''
		setupAutoDetect(contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('tmux')
	})

	test('matches case-insensitively', () => {
		document.title = 'CLAUDE Code'
		let lastContextId = ''
		setupAutoDetect(contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('claude')
	})

	test('matches lazygit title', () => {
		document.title = 'lazygit'
		let lastContextId = ''
		setupAutoDetect(contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('lazygit')
	})

	test('falls back for empty title', () => {
		document.title = ''
		let lastContextId = ''
		setupAutoDetect(contexts, (id) => {
			lastContextId = id
		})
		expect(lastContextId).toBe('tmux')
	})
})
