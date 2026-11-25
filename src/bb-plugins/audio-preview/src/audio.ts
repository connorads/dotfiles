import type { FileSourceInput, SiblingAudio } from '../contracts';

// Deliberately omit webm so BB's native video preview keeps video/webm files.
export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'oga',
  'opus',
  'flac',
  'aac',
  'aiff',
  'aif',
] as const;

const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS);

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export type SortMode = 'name' | 'newest';

const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function fileExtension(filePath: string): string {
  const name = basename(filePath);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function isAudioFilename(name: string): boolean {
  const ext = fileExtension(name);
  return ext.length > 0 && AUDIO_EXTENSION_SET.has(ext);
}

export function normalizePosixPath(raw: string): string {
  const normalized = raw.replaceAll('\\', '/');
  const isAbsolute = normalized.startsWith('/');
  const parts: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length > 0 && parts.at(-1) !== '..') {
        parts.pop();
      } else if (!isAbsolute) {
        parts.push('..');
      }
      continue;
    }
    parts.push(segment);
  }
  if (isAbsolute) return `/${parts.join('/')}`;
  return parts.join('/');
}

export function basename(filePath: string): string {
  const cleaned = filePath.replaceAll('\\', '/').replace(/\/+$/u, '');
  const slash = cleaned.lastIndexOf('/');
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
}

export function dirname(filePath: string): string {
  const cleaned = filePath.replaceAll('\\', '/').replace(/\/+$/u, '');
  const slash = cleaned.lastIndexOf('/');
  if (slash === -1) return '';
  if (slash === 0) return '/';
  return cleaned.slice(0, slash);
}

export function joinUnderRoot(rootPath: string, relativeOrAbsolute: string): string | null {
  const root = normalizePosixPath(rootPath);
  if (!root.startsWith('/')) return null;
  const candidate = relativeOrAbsolute.startsWith('/')
    ? normalizePosixPath(relativeOrAbsolute)
    : normalizePosixPath(`${root}/${relativeOrAbsolute}`);
  if (candidate === root) return candidate;
  const prefix = root === '/' ? '/' : `${root}/`;
  return candidate.startsWith(prefix) ? candidate : null;
}

export function relativeUnderRoot(rootPath: string, absolutePath: string): string | null {
  const root = normalizePosixPath(rootPath);
  const abs = normalizePosixPath(absolutePath);
  if (!root.startsWith('/') || !abs.startsWith('/')) return null;
  if (abs === root) return '';
  const prefix = root === '/' ? '/' : `${root}/`;
  if (!abs.startsWith(prefix)) return null;
  return abs.slice(prefix.length);
}

function encodePathSegments(filePath: string): string {
  return filePath
    .replace(/^\/+/u, '')
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

export function buildFileUrl(filePath: string, source: FileSourceInput): string | null {
  const encoded = encodePathSegments(filePath);
  if (!encoded) return null;
  switch (source.kind) {
    case 'workspace':
      if (source.environmentId !== null) {
        return `/api/v1/environments/${encodeURIComponent(source.environmentId)}/files/${encoded}`;
      }
      if (source.projectId !== null) {
        const base = `/api/v1/projects/${encodeURIComponent(source.projectId)}`;
        return source.experimental_hostId
          ? `${base}/hosts/${encodeURIComponent(source.experimental_hostId)}/files/${encoded}`
          : `${base}/files/${encoded}`;
      }
      return null;
    case 'host':
      return source.threadId === null
        ? null
        : `/api/v1/threads/${encodeURIComponent(source.threadId)}/host-files/${encoded}`;
    case 'thread-storage':
      return source.threadId === null
        ? null
        : `/api/v1/threads/${encodeURIComponent(source.threadId)}/thread-storage/files/${encoded}`;
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const paddedSecs = String(secs).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSecs}`;
  }
  return `${minutes}:${paddedSecs}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatBadge(filePath: string, contentType: string | null): string {
  const ext = fileExtension(filePath);
  if (ext) return ext.toUpperCase();
  if (!contentType) return 'AUDIO';
  const subtype = contentType.split(';', 1)[0]?.split('/')[1]?.trim();
  return subtype ? subtype.toUpperCase() : 'AUDIO';
}

export function computeWaveformPeaks(samples: Float32Array, barCount: number): number[] {
  const count = Math.max(1, Math.floor(barCount));
  if (samples.length === 0) return Array.from({ length: count }, () => 0);

  const raw = new Float32Array(count);
  const samplesPerBar = samples.length / count;
  let globalMax = 0;

  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * samplesPerBar);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((i + 1) * samplesPerBar)));
    let peak = 0;
    let sumSq = 0;
    const len = end - start;
    // Stride large blocks so decoding a long track stays sub-millisecond.
    const step = Math.max(1, Math.floor(len / 512));
    let visited = 0;
    for (let j = start; j < end; j += step) {
      const value = Math.abs(samples[j] ?? 0);
      if (value > peak) peak = value;
      sumSq += value * value;
      visited += 1;
    }
    const rms = visited > 0 ? Math.sqrt(sumSq / visited) : 0;
    const blended = rms * 0.65 + peak * 0.35;
    raw[i] = blended;
    if (blended > globalMax) globalMax = blended;
  }

  if (globalMax <= 0) return Array.from({ length: count }, () => 0);
  return Array.from(raw, (value) => Math.min(1, value / globalMax));
}

export function sortSiblings(items: readonly SiblingAudio[], mode: SortMode): SiblingAudio[] {
  const copy = [...items];
  copy.sort((a, b) => {
    if (mode === 'newest') {
      const diff = (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0);
      if (diff !== 0) return diff;
    }
    return naturalNameCollator.compare(a.name, b.name);
  });
  return copy;
}

export function adjacentIndex(currentIndex: number, delta: -1 | 1, length: number): number {
  if (length <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= length) return 0;
  return (currentIndex + delta + length) % length;
}
