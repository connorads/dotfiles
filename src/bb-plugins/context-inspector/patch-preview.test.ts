import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewIntroduction } from './patch-preview';
import { fixtureOwner } from './fixtures';

describe('introduction preview', () => {
  it('preserves unrelated plugin settings and produces an applicable patch', () => {
    const result = previewIntroduction(fixtureOwner, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.desiredJson)).toEqual({ 'bb-guide': { introduction: false, skills: true }, 'demo-plugin': { enabled: true } });
    const root = mkdtempSync(join(tmpdir(), 'context-preview-'));
    mkdirSync(join(root, '.config/bb'), { recursive: true });
    writeFileSync(join(root, '.config/bb/plugin-config.json'), fixtureOwner);
    execFileSync('git', ['apply', '--check', '-'], { cwd: root, input: result.patch });
    execFileSync('git', ['apply', '-'], { cwd: root, input: result.patch });
    expect(readFileSync(join(root, '.config/bb/plugin-config.json'), 'utf8')).toBe(result.desiredJson);
  });
  it('adds the exact declaration when unmanaged', () => {
    const result = previewIntroduction('{}', false);
    expect(result.ok && JSON.parse(result.desiredJson)).toEqual({ 'bb-guide': { introduction: false } });
  });
  it.each(['bad JSON', 'null', '[]', '{"bb-guide":null}', '{"bb-guide":{"introduction":"false"}}', '{"other":3}', '{"other":{"setting":null}}', '{"other":{"setting":[]}}', '{"other":{"setting":{}}}'])('rejects malformed owner %s', owner => {
    expect(previewIntroduction(owner, false).ok).toBe(false);
  });
  it('does not create a patch for an unchanged desired value', () => {
    const result = previewIntroduction(fixtureOwner, true);
    expect(result.ok && result.patch).toBe('');
  });
});

it('preserves unrelated scalar values exactly', () => {
  const owner = { other: { enabled: false, count: 1.25, label: 'synthetic' } };
  const result = previewIntroduction(JSON.stringify(owner), true);
  expect(result.ok && JSON.parse(result.desiredJson).other).toEqual(owner.other);
});
