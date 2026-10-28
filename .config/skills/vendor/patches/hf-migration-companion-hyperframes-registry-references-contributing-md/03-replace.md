#    no longer exists is worse, because `hyperframes add <name>` resolves the
#    name and then fails on missing files.
pnpm exec tsx scripts/generate-registry-items.ts

# 4. Generate catalog docs page
pnpm exec tsx scripts/generate-catalog-pages.ts

# 5. Publish to hyperframes.studio so reviewers can preview
hyperframes publish

# 6. Stage everything
