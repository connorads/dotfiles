import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  definePluginApp,
  useRpc,
  type PluginFileOpenerProps,
} from '@get-bb/plugin-sdk/app';
import type { rpcContract, SiblingAudio } from './contracts';
import {
  AUDIO_EXTENSIONS,
  PLAYBACK_RATES,
  adjacentIndex,
  basename,
  buildFileUrl,
  computeWaveformPeaks,
  dirname,
  formatBadge,
  formatBytes,
  formatTime,
  sortSiblings,
  type SortMode,
} from './src/audio';
import {
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  RepeatIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpinnerIcon,
  VolumeIcon,
  VolumeMutedIcon,
} from './src/icons';
import { Waveform } from './src/waveform';
import './app.css';

const WAVEFORM_BARS = 112;
const MAX_WAVEFORM_BYTES = 50 * 1024 * 1024;
const MAX_PEAK_CACHE = 32;

const peakCache = new Map<string, { peaks: number[]; sizeBytes: number | null; contentType: string | null }>();

function rememberPeaks(
  key: string,
  entry: { peaks: number[]; sizeBytes: number | null; contentType: string | null },
) {
  if (peakCache.has(key)) peakCache.delete(key);
  peakCache.set(key, entry);
  if (peakCache.size > MAX_PEAK_CACHE) {
    const oldest = peakCache.keys().next().value;
    if (oldest !== undefined) peakCache.delete(oldest);
  }
}

async function decodeWaveform(
  url: string,
  signal: AbortSignal,
  bustCache: boolean,
): Promise<{ peaks: number[] | null; sizeBytes: number | null; contentType: string | null }> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: bustCache ? 'reload' : 'default',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Audio request failed with status ${response.status}.`);
  }
  const contentType = response.headers.get('content-type');
  const rawLength = response.headers.get('content-length');
  const parsedLength = rawLength ? Number.parseInt(rawLength, 10) : Number.NaN;
  const headerSize = Number.isFinite(parsedLength) && parsedLength >= 0 ? parsedLength : null;

  if (headerSize !== null && headerSize > MAX_WAVEFORM_BYTES) {
    return { peaks: null, sizeBytes: headerSize, contentType };
  }

  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  const sizeBytes = headerSize ?? buffer.byteLength;

  if (buffer.byteLength > MAX_WAVEFORM_BYTES || typeof AudioContext === 'undefined') {
    return { peaks: null, sizeBytes, contentType };
  }

  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    signal.throwIfAborted();
    const channel = decoded.getChannelData(0);
    return {
      peaks: computeWaveformPeaks(channel, WAVEFORM_BARS),
      sizeBytes,
      contentType,
    };
  } catch {
    // Some codecs play in <audio> even when decodeAudioData cannot decode them.
    return { peaks: null, sizeBytes, contentType };
  } finally {
    await audioContext.close().catch(() => {});
  }
}

interface PendingSwitch {
  autoPlay: boolean;
  resumeTime: number | null;
}

function AudioPlayer({ path, source, Original }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSwitchRef = useRef<PendingSwitch | null>(null);

  const [activePath, setActivePath] = useState(path);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [contentType, setContentType] = useState<string | null>(null);

  const [siblings, setSiblings] = useState<SiblingAudio[]>([]);
  const [directoryLabel, setDirectoryLabel] = useState(() => dirname(path));
  const [siblingsLoading, setSiblingsLoading] = useState(true);
  const [siblingsTruncated, setSiblingsTruncated] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [autoPlayOnSwitch, setAutoPlayOnSwitch] = useState(true);
  const [keepPositionOnSwitch, setKeepPositionOnSwitch] = useState(false);

  const url = useMemo(() => buildFileUrl(activePath, source), [activePath, source]);
  const sortedSiblings = useMemo(() => sortSiblings(siblings, sortMode), [siblings, sortMode]);
  const activeIndex = useMemo(
    () => sortedSiblings.findIndex((item) => item.path === activePath),
    [sortedSiblings, activePath],
  );
  const activeSibling = activeIndex >= 0 ? sortedSiblings[activeIndex] : null;

  // Fetch same-folder audio takes once per opened directory (and on manual reload).
  useEffect(() => {
    let cancelled = false;
    setSiblingsLoading(true);
    rpc
      .call('listSiblings', { path, source })
      .then((result) => {
        if (cancelled) return;
        setSiblings(result.items);
        setDirectoryLabel(result.directoryLabel || dirname(path));
        setSiblingsTruncated(result.truncated);
      })
      .catch(() => {
        if (cancelled) return;
        setSiblings([]);
        setSiblingsTruncated(false);
      })
      .finally(() => {
        if (!cancelled) setSiblingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, path, source, reloadNonce]);

  // Decode waveform for the active audio URL (with in-memory LRU cache).
  useEffect(() => {
    if (!url) return;
    setAudioError(null);

    if (reloadNonce === 0) {
      const cached = peakCache.get(url);
      if (cached) {
        setPeaks(cached.peaks);
        setSizeBytes(cached.sizeBytes);
        setContentType(cached.contentType);
        setDecoding(false);
        return;
      }
    }

    const controller = new AbortController();
    setPeaks(null);
    setDecoding(true);

    decodeWaveform(url, controller.signal, reloadNonce > 0)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPeaks(result.peaks);
        setSizeBytes(result.sizeBytes);
        setContentType(result.contentType);
        if (result.peaks) {
          rememberPeaks(url, {
            peaks: result.peaks,
            sizeBytes: result.sizeBytes,
            contentType: result.contentType,
          });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPeaks(null);
        setAudioError(error instanceof Error ? error.message : 'Failed to load audio.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setDecoding(false);
      });

    return () => controller.abort();
  }, [url, reloadNonce]);

  // Keep <audio> element properties synced with React controls.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    audio.loop = loop;
    audio.muted = muted;
    audio.volume = volume;
  }, [playbackRate, loop, muted, volume]);

  // Reset playback state when switching tracks or reloading.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    audio.load();
  }, [url, reloadNonce]);

  const selectTrack = useCallback(
    (nextPath: string) => {
      if (nextPath === activePath) {
        const audio = audioRef.current;
        if (audio) {
          if (audio.paused) {
            void audio.play().catch(() => {});
          } else {
            audio.pause();
          }
        }
        return;
      }
      const audio = audioRef.current;
      const resumeTime =
        keepPositionOnSwitch && audio && Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : null;
      const shouldPlay = autoPlayOnSwitch || isPlaying;
      pendingSwitchRef.current = { autoPlay: shouldPlay, resumeTime };
      setActivePath(nextPath);
    },
    [activePath, autoPlayOnSwitch, isPlaying, keepPositionOnSwitch],
  );

  const stepTrack = useCallback(
    (delta: -1 | 1) => {
      if (sortedSiblings.length < 2) return;
      const nextIdx = adjacentIndex(activeIndex, delta, sortedSiblings.length);
      const next = sortedSiblings[nextIdx];
      if (next) selectTrack(next.path);
    },
    [sortedSiblings, activeIndex, selectTrack],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch((error) => {
        setAudioError(error instanceof Error ? error.message : 'Could not start playback.');
      });
    } else {
      audio.pause();
    }
  }, []);

  const seekTo = useCallback((targetSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : 0, targetSeconds));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      seekTo(audio.currentTime + deltaSeconds);
    },
    [seekTo],
  );

  function handleContainerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }

    switch (event.key) {
      case ' ':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        seekBy(event.shiftKey ? -1 : -5);
        break;
      case 'ArrowRight':
        event.preventDefault();
        seekBy(event.shiftKey ? 1 : 5);
        break;
      case 'ArrowUp':
      case 'k':
        if (sortedSiblings.length > 1) {
          event.preventDefault();
          stepTrack(-1);
        }
        break;
      case 'ArrowDown':
      case 'j':
        if (sortedSiblings.length > 1) {
          event.preventDefault();
          stepTrack(1);
        }
        break;
      case 'l':
        event.preventDefault();
        setLoop((prev) => !prev);
        break;
      case 'm':
        event.preventDefault();
        setMuted((prev) => !prev);
        break;
      case '0':
        event.preventDefault();
        seekTo(0);
        break;
      default:
        break;
    }
  }

  if (url === null) {
    return <Original />;
  }

  const fileName = basename(activePath);
  const displayedSize = activeSibling?.sizeBytes ?? sizeBytes;
  const badge = formatBadge(activePath, contentType);
  const canStep = sortedSiblings.length > 1;

  return (
    <div className="ap-root" tabIndex={0} onKeyDown={handleContainerKeyDown}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          const nextDuration = Number.isFinite(el.duration) ? el.duration : 0;
          setDuration(nextDuration);
          el.playbackRate = playbackRate;
          el.loop = loop;
          el.muted = muted;
          el.volume = volume;

          const pending = pendingSwitchRef.current;
          if (pending) {
            pendingSwitchRef.current = null;
            if (pending.resumeTime !== null && nextDuration > 0) {
              const clamped = Math.min(pending.resumeTime, Math.max(0, nextDuration - 0.1));
              el.currentTime = clamped;
              setCurrentTime(clamped);
            }
            if (pending.autoPlay) {
              void el.play().catch(() => {});
            }
          }
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setIsPlaying(false);
          setAudioError('This browser could not play this audio file.');
        }}
      />

      <div className="ap-card">
        <header className="ap-header">
          <div className="ap-title-group">
            <div className="ap-filename" title={activePath}>
              {fileName}
            </div>
            {directoryLabel && (
              <div className="ap-folder" title={directoryLabel}>
                {directoryLabel}
              </div>
            )}
          </div>
          <div className="ap-header-actions">
            <span className="ap-pill">{badge}</span>
            {displayedSize !== null && <span className="ap-pill">{formatBytes(displayedSize)}</span>}
            <button
              type="button"
              className="ap-icon-btn"
              title="Reload audio and folder list"
              aria-label="Reload audio and folder list"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RefreshIcon className="ap-icon" />
            </button>
            <a
              className="ap-icon-btn"
              href={url}
              download={fileName}
              title={`Download ${fileName}`}
              aria-label={`Download ${fileName}`}
            >
              <DownloadIcon className="ap-icon" />
            </a>
          </div>
        </header>

        {audioError ? (
          <div className="ap-error" role="alert">
            <span>{audioError}</span>
            <button
              type="button"
              className="ap-btn"
              onClick={() => {
                setAudioError(null);
                setReloadNonce((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="ap-waveform-wrap">
              <Waveform
                peaks={peaks}
                decoding={decoding}
                currentTime={currentTime}
                duration={duration}
                onSeek={seekTo}
              />
              <div className="ap-time-row">
                <span className="ap-time">{formatTime(currentTime)}</span>
                <span className="ap-time ap-time-total">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="ap-controls">
              <div className="ap-transport">
                {canStep && (
                  <button
                    type="button"
                    className="ap-icon-btn"
                    title="Previous take (Up / K)"
                    aria-label="Previous take"
                    onClick={() => stepTrack(-1)}
                  >
                    <SkipBackIcon className="ap-icon" />
                  </button>
                )}
                <button
                  type="button"
                  className="ap-btn ap-btn-compact"
                  title="Back 5 seconds (Left arrow)"
                  aria-label="Back 5 seconds"
                  onClick={() => seekBy(-5)}
                >
                  -5s
                </button>
                <button
                  type="button"
                  className="ap-play-btn"
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  onClick={togglePlay}
                >
                  {isPlaying ? <PauseIcon className="ap-play-icon" /> : <PlayIcon className="ap-play-icon" />}
                </button>
                <button
                  type="button"
                  className="ap-btn ap-btn-compact"
                  title="Forward 5 seconds (Right arrow)"
                  aria-label="Forward 5 seconds"
                  onClick={() => seekBy(5)}
                >
                  +5s
                </button>
                {canStep && (
                  <button
                    type="button"
                    className="ap-icon-btn"
                    title="Next take (Down / J)"
                    aria-label="Next take"
                    onClick={() => stepTrack(1)}
                  >
                    <SkipForwardIcon className="ap-icon" />
                  </button>
                )}
              </div>

              <div className="ap-secondary">
                <button
                  type="button"
                  className={`ap-btn ap-btn-compact${loop ? ' ap-btn-active' : ''}`}
                  aria-pressed={loop}
                  title="Toggle loop (L)"
                  onClick={() => setLoop((prev) => !prev)}
                >
                  <RepeatIcon className="ap-icon" />
                </button>

                <div className="ap-rates" role="group" aria-label="Playback speed">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={`ap-rate-btn${playbackRate === rate ? ' ap-rate-active' : ''}`}
                      aria-pressed={playbackRate === rate}
                      onClick={() => setPlaybackRate(rate)}
                    >
                      {rate}×
                    </button>
                  ))}
                </div>

                <div className="ap-volume">
                  <button
                    type="button"
                    className="ap-icon-btn"
                    title={muted ? 'Unmute (M)' : 'Mute (M)'}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    aria-pressed={muted}
                    onClick={() => setMuted((prev) => !prev)}
                  >
                    {muted || volume === 0 ? (
                      <VolumeMutedIcon className="ap-icon" />
                    ) : (
                      <VolumeIcon className="ap-icon" />
                    )}
                  </button>
                  <input
                    type="range"
                    className="ap-volume-slider"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label="Volume"
                    value={muted ? 0 : volume}
                    onChange={(event) => {
                      const next = Number.parseFloat(event.target.value);
                      setVolume(next);
                      if (next > 0 && muted) setMuted(false);
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <section className="ap-siblings" aria-label="Audio files in this folder">
        <div className="ap-siblings-header">
          <div className="ap-siblings-title">
            <span>Folder takes</span>
            {!siblingsLoading && <span className="ap-count">{sortedSiblings.length}</span>}
            {siblingsTruncated && <span className="ap-muted">capped</span>}
          </div>
          <div className="ap-siblings-controls">
            <button
              type="button"
              className={`ap-toggle${autoPlayOnSwitch ? ' ap-toggle-on' : ''}`}
              aria-pressed={autoPlayOnSwitch}
              title="Start playing immediately when switching takes"
              onClick={() => setAutoPlayOnSwitch((prev) => !prev)}
            >
              Auto-play
            </button>
            <button
              type="button"
              className={`ap-toggle${keepPositionOnSwitch ? ' ap-toggle-on' : ''}`}
              aria-pressed={keepPositionOnSwitch}
              title="Keep playback timestamp when switching takes for A/B comparison"
              onClick={() => setKeepPositionOnSwitch((prev) => !prev)}
            >
              Keep pos
            </button>
            <button
              type="button"
              className="ap-toggle"
              title="Toggle sort order between natural filename and newest modified"
              onClick={() => setSortMode((prev) => (prev === 'name' ? 'newest' : 'name'))}
            >
              {sortMode === 'name' ? 'A-Z' : 'Newest'}
            </button>
          </div>
        </div>

        {siblingsLoading ? (
          <div className="ap-siblings-empty">
            <SpinnerIcon className="ap-icon ap-spin" />
            <span>Loading folder takes…</span>
          </div>
        ) : sortedSiblings.length === 0 ? (
          <div className="ap-siblings-empty">No other audio files found in this folder.</div>
        ) : (
          <ul className="ap-sibling-list">
            {sortedSiblings.map((item) => {
              const active = item.path === activePath;
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    className={`ap-sibling-row${active ? ' ap-sibling-active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => selectTrack(item.path)}
                  >
                    <span className="ap-sibling-indicator" aria-hidden="true">
                      {active ? (
                        isPlaying ? (
                          <VolumeIcon className="ap-icon" />
                        ) : (
                          <PlayIcon className="ap-icon" />
                        )
                      ) : (
                        <span className="ap-sibling-dot" />
                      )}
                    </span>
                    <span className="ap-sibling-name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="ap-sibling-meta">
                      <span className="ap-sibling-ext">{item.extension.toUpperCase()}</span>
                      {item.sizeBytes !== null && (
                        <span className="ap-sibling-size">{formatBytes(item.sizeBytes)}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="ap-hints" aria-hidden="true">
        <span>Space play/pause</span>
        <span>←/→ ±5s</span>
        {canStep && <span>↑/↓ switch take</span>}
        <span>L loop</span>
        <span>M mute</span>
      </footer>
    </div>
  );
}

function AudioFilePreview(props: PluginFileOpenerProps) {
  const key = [
    props.path,
    props.source.kind,
    props.source.environmentId,
    props.source.projectId,
    props.source.threadId,
    props.source.experimental_hostId,
  ].join('\0');
  return <AudioPlayer key={key} {...props} />;
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: 'audio',
    title: 'Audio preview',
    extensions: AUDIO_EXTENSIONS,
    component: AudioFilePreview,
  });
});
