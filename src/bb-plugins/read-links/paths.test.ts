import { expect, it } from 'vitest';
import { collectTargets, resolvePath, type TimelineRow } from './paths';

const command = (id: string, activityIntents: TimelineRow['activityIntents'], extra: Partial<TimelineRow> = {}): TimelineRow =>
  ({ id, kind: 'work', workKind: 'command', cwd: '/work', approvalStatus: null, activityIntents, ...extra });

it('maps file reads and image views to their paths', () => {
  const targets = collectTargets([
    { id: 't:file-read:1', kind: 'work', workKind: 'file-read', path: '/a/notes.md' },
    { id: 't:image-view:2', kind: 'work', workKind: 'image-view', path: '/a/shot.png' },
  ], null);
  expect([...targets]).toEqual([['t:file-read:1', ['/a/notes.md']], ['t:image-view:2', ['/a/shot.png']]]);
});

it('gives one entry per rendered command title, matching BB skipping and dedupe', () => {
  const targets = collectTargets([command('t:command:1', [
    { type: 'read', path: 'src/a.ts', name: 'cat' },
    { type: 'unknown' },
    { type: 'read', path: 'src/a.ts', name: 'cat' },
    { type: 'list_files', path: 'src' },
    { type: 'read', path: '~/b.md', name: 'head' },
    { type: 'read', path: null, name: 'cat' },
  ])], '/home/sam');
  expect(targets.get('t:command:1')).toEqual(['/work/src/a.ts', null, '/home/sam/b.md', null]);
});

it('maps nothing for commands awaiting approval, and records them as known', () => {
  const targets = collectTargets([command('t:command:1', [{ type: 'read', path: '/a', name: 'cat' }], { approvalStatus: 'waiting_for_approval' })], null);
  expect(targets.get('t:command:1')).toEqual([]);
});

it('walks nested rows', () => {
  const targets = collectTargets([{ id: 't:turn:1', kind: 'turn', children: [{ id: 't:file-read:2', kind: 'work', workKind: 'file-read', path: '/x' }] }], null);
  expect(targets.get('t:file-read:2')).toEqual(['/x']);
});

it('resolves only paths it can place on the host', () => {
  expect(resolvePath('/abs', { home: null })).toBe('/abs');
  expect(resolvePath('./a/b', { cwd: '/work/', home: null })).toBe('/work/a/b');
  expect(resolvePath('~/x', { cwd: '/work', home: '/home/sam/' })).toBe('/home/sam/x');
  expect(resolvePath('~/x', { cwd: '/work', home: null })).toBeNull();
  expect(resolvePath('~other/x', { cwd: '/work', home: '/home/sam' })).toBeNull();
  // Claude Code records an empty cwd for shell commands.
  expect(resolvePath('rel', { cwd: '', home: '/home/sam' })).toBeNull();
  expect(resolvePath('rel', { cwd: 'relative-cwd', home: null })).toBeNull();
});
