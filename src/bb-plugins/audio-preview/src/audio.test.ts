import { describe, expect, test } from 'vitest';
import {
  AUDIO_EXTENSIONS,
  adjacentIndex,
  basename,
  buildFileUrl,
  computeWaveformPeaks,
  dirname,
  formatBadge,
  formatBytes,
  formatTime,
  isAudioFilename,
  joinUnderRoot,
  relativeUnderRoot,
  sortSiblings,
} from './audio';

describe('audio filename matching', () => {
  test('matches supported audio extensions case-insensitively and skips webm', () => {
    for (const ext of AUDIO_EXTENSIONS) {
      expect(isAudioFilename(`take.${ext}`)).toBe(true);
      expect(isAudioFilename(`take.${ext.toUpperCase()}`)).toBe(true);
    }
    expect(isAudioFilename('clip.webm')).toBe(false);
    expect(isAudioFilename('video.mp4')).toBe(false);
    expect(isAudioFilename('README.md')).toBe(false);
    expect(isAudioFilename('.mp3')).toBe(false);
    expect(isAudioFilename('noext')).toBe(false);
  });
});

describe('path helpers', () => {
  test('basename and dirname handle nested and root paths', () => {
    expect(basename('out/voice/take-1.mp3')).toBe('take-1.mp3');
    expect(dirname('out/voice/take-1.mp3')).toBe('out/voice');
    expect(dirname('take-1.mp3')).toBe('');
    expect(dirname('/take-1.mp3')).toBe('/');
  });

  test('joinUnderRoot confines paths under the root and rejects traversal', () => {
    expect(joinUnderRoot('/repo/app', 'out/voice/a.mp3')).toBe('/repo/app/out/voice/a.mp3');
    expect(joinUnderRoot('/repo/app/', './out/../out/a.mp3')).toBe('/repo/app/out/a.mp3');
    expect(joinUnderRoot('/repo/app', '../secret.mp3')).toBeNull();
    expect(joinUnderRoot('/repo/app', '/other/a.mp3')).toBeNull();
    expect(joinUnderRoot('relative/root', 'a.mp3')).toBeNull();
  });

  test('relativeUnderRoot computes workspace-relative paths safely', () => {
    expect(relativeUnderRoot('/repo/app', '/repo/app/out/a.mp3')).toBe('out/a.mp3');
    expect(relativeUnderRoot('/repo/app', '/repo/app')).toBe('');
    expect(relativeUnderRoot('/repo/app', '/repo/app-other/a.mp3')).toBeNull();
  });
});

describe('buildFileUrl', () => {
  test('builds authenticated BB file URLs for every source kind', () => {
    expect(
      buildFileUrl('out/voice/take #1.mp3', {
        kind: 'workspace',
        environmentId: 'env_1',
        projectId: 'proj_1',
        threadId: 'thr_1',
      }),
    ).toBe('/api/v1/environments/env_1/files/out/voice/take%20%231.mp3');

    expect(
      buildFileUrl('out/a.mp3', {
        kind: 'workspace',
        environmentId: null,
        projectId: 'proj_1',
        threadId: null,
      }),
    ).toBe('/api/v1/projects/proj_1/files/out/a.mp3');

    expect(
      buildFileUrl('out/a.mp3', {
        kind: 'workspace',
        environmentId: null,
        projectId: 'proj_1',
        threadId: null,
        experimental_hostId: 'host_remote',
      }),
    ).toBe('/api/v1/projects/proj_1/hosts/host_remote/files/out/a.mp3');

    expect(
      buildFileUrl('/tmp/audio/clip.wav', {
        kind: 'host',
        environmentId: null,
        projectId: null,
        threadId: 'thr_1',
      }),
    ).toBe('/api/v1/threads/thr_1/host-files/tmp/audio/clip.wav');

    expect(
      buildFileUrl('renders/clip.m4a', {
        kind: 'thread-storage',
        environmentId: null,
        projectId: null,
        threadId: 'thr_1',
      }),
    ).toBe('/api/v1/threads/thr_1/thread-storage/files/renders/clip.m4a');
  });

  test('returns null when required identifiers are missing', () => {
    expect(
      buildFileUrl('a.mp3', {
        kind: 'workspace',
        environmentId: null,
        projectId: null,
        threadId: null,
      }),
    ).toBeNull();
    expect(
      buildFileUrl('a.mp3', {
        kind: 'thread-storage',
        environmentId: null,
        projectId: null,
        threadId: null,
      }),
    ).toBeNull();
  });
});

describe('formatting helpers', () => {
  test('formats durations cleanly including hours and invalid numbers', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(4.9)).toBe('0:04');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });

  test('formats byte sizes and badges', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(204 * 1024)).toBe('204 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(formatBytes(null)).toBe('');
    expect(formatBadge('take.mp3', 'audio/mpeg')).toBe('MP3');
    expect(formatBadge('unknown', 'audio/ogg; codecs=opus')).toBe('OGG');
  });
});

describe('waveform and sibling helpers', () => {
  test('normalises waveform peaks to [0, 1] and handles silent buffers', () => {
    const samples = new Float32Array([0, 0, 0.25, -0.25, 0.5, -0.5, 1, -1]);
    const peaks = computeWaveformPeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBe(0);
    expect(peaks[3]).toBeCloseTo(1, 5);
    expect(peaks[1]!).toBeLessThan(peaks[2]!);
    expect(peaks[2]!).toBeLessThan(peaks[3]!);

    expect(computeWaveformPeaks(new Float32Array(16), 4)).toEqual([0, 0, 0, 0]);
  });

  test('sorts siblings naturally by name or descending mtime', () => {
    const items = [
      { name: 'take-10.mp3', path: 'out/take-10.mp3', extension: 'mp3', sizeBytes: 10, mtimeMs: 300 },
      { name: 'take-2.mp3', path: 'out/take-2.mp3', extension: 'mp3', sizeBytes: 10, mtimeMs: 100 },
      { name: 'take-1.mp3', path: 'out/take-1.mp3', extension: 'mp3', sizeBytes: 10, mtimeMs: 200 },
    ];
    expect(sortSiblings(items, 'name').map((i) => i.name)).toEqual([
      'take-1.mp3',
      'take-2.mp3',
      'take-10.mp3',
    ]);
    expect(sortSiblings(items, 'newest').map((i) => i.name)).toEqual([
      'take-10.mp3',
      'take-1.mp3',
      'take-2.mp3',
    ]);
  });

  test('wraps adjacent indices cleanly', () => {
    expect(adjacentIndex(0, -1, 3)).toBe(2);
    expect(adjacentIndex(2, 1, 3)).toBe(0);
    expect(adjacentIndex(1, 1, 3)).toBe(2);
    expect(adjacentIndex(-1, 1, 3)).toBe(0);
    expect(adjacentIndex(0, 1, 0)).toBe(-1);
  });
});
