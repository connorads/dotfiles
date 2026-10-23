
```bash
hyperframes render                                # standard MP4 from cwd
hyperframes render ./my-video --output ./out.mp4  # render from outside the project dir
hyperframes render --output final.mp4             # named output (no timestamp)
hyperframes render -c compositions/intro.html -o intro.mp4  # render a specific sub-composition file
hyperframes render --quality draft                # fast iteration
hyperframes render --quality looks                # first real encode (default)
hyperframes render --fps 60 --quality delivery    # final delivery
hyperframes render --format webm                  # transparent WebM
hyperframes render --docker                       # byte-identical
```
