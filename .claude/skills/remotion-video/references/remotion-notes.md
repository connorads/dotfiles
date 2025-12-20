# Remotion notes and snippets (from user)

This file stores the detailed notes you provided (the goal is to keep `SKILL.md` lean and point here).

## Project structure

The Root file is usually named `src/Root.tsx` and looks like this:

```tsx
import {Composition} from 'remotion';
import {MyComp} from './MyComp';

export const Root: React.FC = () => {
	return (
		<>
			<Composition
				id="MyComp"
				component={MyComp}
				durationInFrames={120}
				width={1920}
				height={1080}
				fps={30}
				defaultProps={{}}
			/>
		</>
	);
};
```

A `<Composition>` defines a video that can be rendered. It consists of:
- a React component
- an id
- a durationInFrames
- a width
- a height
- a frame rate (fps)

Defaults (per notes):
- `fps`: 30
- `width`: 1920
- `height`: 1080
- `id`: `MyComp`

`defaultProps` must match the component’s props shape.

## Getting the current frame

Inside a React component, use `useCurrentFrame()` to get the current frame number (frames start at 0).

```tsx
import {useCurrentFrame} from 'remotion';

export const MyComp: React.FC = () => {
	const frame = useCurrentFrame();
	return <div>Frame {frame}</div>;
};
```

## Component rules

- Return regular HTML and SVG tags.
- Use special Remotion tags for media.

### Video: `<OffthreadVideo>`

```tsx
import {OffthreadVideo} from 'remotion';

export const MyComp: React.FC = () => {
	return (
		<div>
			<OffthreadVideo
				src="https://remotion.dev/bbb.mp4"
				style={{width: '100%'}}
			/>
		</div>
	);
};
```

Notes:
- `startFrom` trims the left side by frames (older name)
- `endAt` limits how long the video is shown (older name)
- Newer Remotion uses `trimBefore` / `trimAfter` (see `references/remotion-media.md`).
- `volume` sets volume (commonly 0–1)

### Image: `<Img>`

```tsx
import {Img} from 'remotion';

export const MyComp: React.FC = () => {
	return <Img src="https://remotion.dev/logo.png" style={{width: '100%'}} />;
};
```

### GIF: `@remotion/gif`

```tsx
import {Gif} from '@remotion/gif';

export const MyComp: React.FC = () => {
	return (
		<Gif
			src="https://media.giphy.com/media/l0MYd5y8e1t0m/giphy.gif"
			style={{width: '100%'}}
		/>
	);
};
```

### Audio: `<Audio>`

```tsx
import {Audio} from 'remotion';

export const MyComp: React.FC = () => {
	return <Audio src="https://remotion.dev/audio.mp3" />;
};
```

From `public/` using `staticFile()`:

```tsx
import {Audio, staticFile} from 'remotion';

export const MyComp: React.FC = () => {
	return <Audio src={staticFile('audio.mp3')} />;
};
```

Audio notes:
- `startFrom` trims the left side by frames
- `endAt` limits how long audio is shown
- `volume` sets volume (commonly 0–1)

## Layering: `AbsoluteFill`

```tsx
import {AbsoluteFill} from 'remotion';

export const MyComp: React.FC = () => {
	return (
		<AbsoluteFill>
			<AbsoluteFill style={{background: 'blue'}}>
				<div>This is in the back</div>
			</AbsoluteFill>
			<AbsoluteFill style={{background: 'blue'}}>
				<div>This is in front</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
```

## Timing: `Sequence`

Use `Sequence` to place an element later in the timeline.

```tsx
import {Sequence} from 'remotion';

export const MyComp: React.FC = () => {
	return (
		<Sequence from={10} durationInFrames={20}>
			<div>This only appears after 10 frames</div>
		</Sequence>
	);
};
```

Notes:
- `from` can be negative (starts immediately but trims the first `-from` frames).
- If a child component of `Sequence` calls `useCurrentFrame()`, it starts from 0 when the sequence begins.

```tsx
import {Sequence, useCurrentFrame} from 'remotion';

export const Child: React.FC = () => {
	const frame = useCurrentFrame();
	return <div>At frame 10, this should be 0: {frame}</div>;
};

export const MyComp: React.FC = () => {
	return (
		<Sequence from={10} durationInFrames={20}>
			<Child />
		</Sequence>
	);
};
```

## Back-to-back: `Series`

```tsx
import {Series} from 'remotion';

export const MyComp: React.FC = () => {
	return (
		<Series>
			<Series.Sequence durationInFrames={20}>
				<div>This only appears immediately</div>
			</Series.Sequence>
			<Series.Sequence durationInFrames={30}>
				<div>This only appears after 20 frames</div>
			</Series.Sequence>
			<Series.Sequence durationInFrames={30} offset={-8}>
				<div>This only appears after 42 frames</div>
			</Series.Sequence>
		</Series>
	);
};
```

Notes:
- `Series.Sequence` has no `from`, it uses `offset`.

## Transitions: `TransitionSeries`

Use `TransitionSeries` from `@remotion/transitions`.

```tsx
import {
	linearTiming,
	springTiming,
	TransitionSeries,
} from '@remotion/transitions';

import {fade} from '@remotion/transitions/fade';
import {wipe} from '@remotion/transitions/wipe';

export const MyComp: React.FC = () => {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={60}>
				<Fill color="blue" />
			</TransitionSeries.Sequence>
			<TransitionSeries.Transition
				timing={springTiming({config: {damping: 200}})}
				presentation={fade()}
			/>
			<TransitionSeries.Sequence durationInFrames={60}>
				<Fill color="black" />
			</TransitionSeries.Sequence>
			<TransitionSeries.Transition
				timing={linearTiming({durationInFrames: 30})}
				presentation={wipe()}
			/>
			<TransitionSeries.Sequence durationInFrames={60}>
				<Fill color="white" />
			</TransitionSeries.Sequence>
		</TransitionSeries>
	);
};
```

Notes:
- `TransitionSeries.Transition` must be between `TransitionSeries.Sequence` blocks.

## Determinism: randomness

Remotion must be deterministic.

- Forbidden: `Math.random()` (renders across multiple threads must match)
- Use: `random('my-seed')` from Remotion.

```tsx
import {random} from 'remotion';

export const MyComp: React.FC = () => {
	return <div>Random number: {random('my-seed')}</div>;
};
```

## `interpolate()`

```tsx
import {interpolate, useCurrentFrame} from 'remotion';

export const MyComp: React.FC = () => {
	const frame = useCurrentFrame();
	const value = interpolate(frame, [0, 100], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return <div>Frame {frame}: {value}</div>;
};
```

## `useVideoConfig()`

```tsx
import {useVideoConfig} from 'remotion';

export const MyComp: React.FC = () => {
	const {fps, durationInFrames, height, width} = useVideoConfig();
	return (
		<div>
			fps: {fps} durationInFrames: {durationInFrames} height: {height} width: {width}
		</div>
	);
};
```

## `spring()`

Suggested default usage (per notes):

```tsx
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';

export const MyComp: React.FC = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const value = spring({
		fps,
		frame,
		config: {
			damping: 200,
		},
	});

	return <div>Frame {frame}: {value}</div>;
};
```

## Remotion components vs interactive React components

Remotion components:
- Render frame-by-frame to create videos.
- Must be deterministic.
- Should not rely on user interactions.

Normal React components:
- Can use interactive state (`useState`, event handlers, etc.).

Example comparison (from notes):

```tsx
const Button = () => {
	const [clicked, setClicked] = useState(false);
	return (
		<button
			onClick={() => setClicked(true)}
			style={{background: clicked ? 'blue' : 'gray'}}
		>
			Click me!
		</button>
	);
};
```

```tsx
import {useCurrentFrame, interpolate} from 'remotion';

const AnimatedButton = () => {
	const frame = useCurrentFrame();
	const scale = interpolate(frame, [0, 30], [1, 1.2], {
		extrapolateRight: 'clamp',
	});

	return (
		<div
			style={{
				transform: `scale(${scale})`,
				background: 'blue',
				padding: '10px 20px',
				display: 'inline-block',
			}}
		>
			Click me!
		</div>
	);
};
```
