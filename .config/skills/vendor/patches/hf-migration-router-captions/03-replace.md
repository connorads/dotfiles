
- Stack the video, then the captions, then a cutout of the person from `hyperframes remove-background` (`/media-use`), ordered by `z-index`. Shake or punch in the video and the cutout together in one wrapper.
- `check` treats a `<video>` as opaque across its whole box, so a WebM cutout fails every caption behind it with `text_occluded`: put `data-layout-allow-occlusion` on the cutout and judge from `snapshot`.
