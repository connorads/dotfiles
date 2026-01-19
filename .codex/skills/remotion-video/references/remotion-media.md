# Remotion media notes

This file collects common media patterns for Remotion.

## Video: `<OffthreadVideo>`

Use this when including a video in a composition.

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

Common props:
- Trimming:
  - Newer Remotion: `trimBefore` / `trimAfter`
  - Older (deprecated but may still work): `startFrom` / `endAt`
- `volume`: set volume (commonly in range 0–1; can also be a callback for per-frame volume)

## Images: `<Img>`

```tsx
import {Img} from 'remotion';

export const MyComp: React.FC = () => {
	return <Img src="https://remotion.dev/logo.png" style={{width: '100%'}} />;
};
```

## GIFs: `@remotion/gif`

Install `@remotion/gif` and use `<Gif>`:

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

## Audio: `<Audio>`

Remote URL:

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

Common props:
- Trimming (per your notes): `startFrom`, `endAt`
- `volume`: set volume (commonly 0–1)

## Layering

Use `AbsoluteFill` to stack elements:

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
