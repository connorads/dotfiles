#    no longer exists is worse, because `hyperframes add <name>` resolves the
#    name and then fails on missing files.
npx tsx scripts/generate-registry-items.ts

# 4. Generate catalog docs page
npx tsx scripts/generate-catalog-pages.ts

# 5. Publish to hyperframes.dev so reviewers can preview
npx hyperframes publish

# 6. Stage everything
