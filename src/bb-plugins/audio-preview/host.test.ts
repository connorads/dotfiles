import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { listAudioInDirectory } from './host';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bb-audio-preview-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('listAudioInDirectory', () => {
  test('lists only audio files in the target directory without descending', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'a-take.mp3'), Buffer.alloc(128));
    await writeFile(join(dir, 'b-take.WAV'), Buffer.alloc(256));
    await writeFile(join(dir, 'video.mp4'), Buffer.alloc(64));
    await writeFile(join(dir, 'clip.webm'), Buffer.alloc(64));
    await writeFile(join(dir, 'notes.md'), 'hello');
    await mkdir(join(dir, 'nested'));
    await writeFile(join(dir, 'nested', 'ignored.mp3'), Buffer.alloc(64));
    await symlink(join(dir, 'a-take.mp3'), join(dir, 'linked.mp3'));
    await symlink(join(dir, 'missing.mp3'), join(dir, 'broken.mp3'));

    const result = await listAudioInDirectory(dir);
    expect(result.truncated).toBe(false);
    expect(result.items.map((item) => item.name).sort()).toEqual([
      'a-take.mp3',
      'b-take.WAV',
      'linked.mp3',
    ]);
    expect(result.items.find((item) => item.name === 'a-take.mp3')?.sizeBytes).toBe(128);
  });

  test('returns empty list for missing directories and enforces entry limit', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, '1.mp3'), Buffer.alloc(10));
    await writeFile(join(dir, '2.mp3'), Buffer.alloc(10));
    await writeFile(join(dir, '3.mp3'), Buffer.alloc(10));

    const capped = await listAudioInDirectory(dir, 2);
    expect(capped.truncated).toBe(true);
    expect(capped.items).toHaveLength(2);

    const missing = await listAudioInDirectory(join(dir, 'does-not-exist'));
    expect(missing).toEqual({ items: [], truncated: false });
  });
});
