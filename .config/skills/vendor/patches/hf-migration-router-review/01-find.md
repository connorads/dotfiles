
1. `npx hyperframes check --json`. Besides errors it warns on craft it can measure: a line on screen too briefly to read (`line_unread`), more than 3 s with nothing changing (`dead_stretch`), text under 2.6% of the frame's short side (`text_below_floor`), an empty first frame (`first_frame_empty`, the thumbnail on social players), a film over 15 s with no sound (`film_silent`). A warning is a question, not a rule: fix it, or keep it on purpose and say why in the note (a deliberate hold carries `data-hold`).
2. `npx hyperframes snapshot --review` writes three sheets: each scene just after it starts and at its middle, plus each `data-beat`, a strip across every cut (−0.2 s to +0.2 s), and the beat frames at phone width (360 px). Open all three.
3. Motion between the beats: `snapshot --range START,END --frames 8` around the hero move and the payoff; `keyframes --shot` for a path that must arc or land.
4. The rendered file: `npx hyperframes audio <video> --json` shows whether sound is there, where it hits and how loud it is. You cannot hear it; say so.

