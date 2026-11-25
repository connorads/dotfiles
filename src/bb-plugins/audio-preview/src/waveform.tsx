import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatTime } from './audio';

export interface WaveformProps {
  peaks: readonly number[] | null;
  decoding: boolean;
  currentTime: number;
  duration: number;
  onSeek: (timeSeconds: number) => void;
}

const DEFAULT_BAR_COUNT = 96;

export function Waveform({ peaks, decoding, currentTime, duration, onSeek }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) =>
        prev.width === Math.round(rect.width) && prev.height === Math.round(rect.height)
          ? prev
          : { width: Math.round(rect.width), height: Math.round(rect.height) },
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || size.width <= 0 || size.height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const styles = getComputedStyle(container);
    const playedColor = styles.getPropertyValue('--primary').trim() || '#3b82f6';
    const unplayedColor = styles.getPropertyValue('--muted-foreground').trim() || '#71717a';
    const fgColor = styles.getPropertyValue('--foreground').trim() || '#fafafa';

    const bars = peaks && peaks.length > 0 ? peaks : Array.from({ length: DEFAULT_BAR_COUNT }, () => 0.18);
    const barCount = bars.length;
    const gap = size.width >= 360 ? 2 : 1;
    const barWidth = Math.max(1.5, (size.width - gap * (barCount - 1)) / barCount);
    const midY = size.height / 2;
    const maxAmp = Math.max(8, size.height * 0.44);

    for (let i = 0; i < barCount; i += 1) {
      const ratio = (i + 0.5) / barCount;
      const amp = Math.max(0.06, bars[i] ?? 0.06);
      const halfHeight = Math.max(2, amp * maxAmp);
      const x = i * (barWidth + gap);
      const y = midY - halfHeight;
      const height = halfHeight * 2;

      const isPlayed = ratio <= progress;
      const isHovered = hoverRatio !== null && ((ratio > progress && ratio <= hoverRatio) || (ratio < progress && ratio >= hoverRatio));

      ctx.globalAlpha = isPlayed ? 0.95 : isHovered ? 0.55 : peaks ? 0.28 : 0.18;
      ctx.fillStyle = isPlayed ? playedColor : unplayedColor;

      const radius = Math.min(barWidth / 2, 2);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barWidth, height, radius);
      } else {
        ctx.rect(x, y, barWidth, height);
      }
      ctx.fill();
    }

    // Playhead indicator
    if (duration > 0) {
      const headX = Math.min(size.width - 1, Math.max(1, progress * size.width));
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = fgColor;
      ctx.fillRect(headX - 0.75, 4, 1.5, size.height - 8);
    }

    // Hover hairline
    if (hoverRatio !== null && duration > 0) {
      const hoverX = Math.min(size.width - 1, Math.max(1, hoverRatio * size.width));
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = fgColor;
      ctx.fillRect(hoverX - 0.5, 4, 1, size.height - 8);
    }
  }, [size, peaks, progress, hoverRatio, duration]);

  function ratioFromPointer(event: PointerEvent<HTMLDivElement>): number {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  }

  function seekToRatio(ratio: number) {
    if (duration <= 0) return;
    onSeek(ratio * duration);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || duration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ratio = ratioFromPointer(event);
    setDragging(true);
    setHoverRatio(ratio);
    seekToRatio(ratio);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const ratio = ratioFromPointer(event);
    setHoverRatio(ratio);
    if (dragging) {
      seekToRatio(ratio);
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (duration <= 0) return;
    const step = event.shiftKey ? 1 : 5;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      onSeek(Math.max(0, currentTime - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      onSeek(Math.min(duration, currentTime + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      onSeek(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      onSeek(duration);
    }
  }

  const hoverTime = hoverRatio !== null && duration > 0 ? hoverRatio * duration : null;

  return (
    <div
      ref={containerRef}
      className={`ap-waveform${decoding ? ' ap-waveform-loading' : ''}${duration <= 0 ? ' ap-waveform-disabled' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Audio timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => {
        if (!dragging) setHoverRatio(null);
      }}
      onKeyDown={handleKeyDown}
    >
      <canvas ref={canvasRef} className="ap-waveform-canvas" />
      {hoverTime !== null && hoverRatio !== null && (
        <span
          className="ap-waveform-tooltip"
          style={{ left: `${Math.min(92, Math.max(8, hoverRatio * 100))}%` }}
        >
          {formatTime(hoverTime)}
        </span>
      )}
    </div>
  );
}
