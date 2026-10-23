
```bash
npx hyperframes render                                # standard MP4 from cwd
npx hyperframes render ./my-video --output ./out.mp4  # render from outside the project dir
npx hyperframes render --output final.mp4             # named output (no timestamp)
npx hyperframes render -c compositions/intro.html -o intro.mp4  # render a specific sub-composition file
npx hyperframes render --quality draft                # fast iteration
npx hyperframes render --quality looks                # first real encode (default)
npx hyperframes render --fps 60 --quality delivery    # final delivery
npx hyperframes render --format webm                  # transparent WebM
npx hyperframes render --docker                       # byte-identical
```
