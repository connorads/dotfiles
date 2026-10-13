With a preset code from the user:

```bash
npx shadcn@latest init --preset <code> --template vite --name <app> --no-monorepo -y
```

Without one, pick the style whose geometry is closest to the DESIGN.md and pass it with `--base`:

```bash
npx shadcn@latest init --base base --preset <style> --template vite --name <app> --no-monorepo -y
```

Then:

```bash
cd <app>
npx shadcn@latest info --json
```

`init` with neither `--preset` nor `--base` stops at an interactive library prompt, even with `-y`. Always pass one of them, plus `--no-monorepo`.
