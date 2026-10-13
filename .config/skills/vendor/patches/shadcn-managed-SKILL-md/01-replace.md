pnpm exec shadcn init --name my-app --preset a2r6bw --template vite

# Create a design system app (then follow design-system.md).
pnpm exec shadcn init --name my-ds --preset b0 --template vite --no-monorepo -y
pnpm exec shadcn init --name my-ds --base base --preset maia --template vite --no-monorepo -y
pnpm exec shadcn add --all -y

# Create a monorepo project.
pnpm exec shadcn init --name my-app --preset base-nova --monorepo
