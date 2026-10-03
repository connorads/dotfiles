# northgate-dental-web

Website for Northgate Dental, 12 clinics across West and North Yorkshire. NHS and private patients.

## Develop

```sh
pnpm install
pnpm dev
```

## Notes for the agency

- Clinic data lives in `data/cities.json`. Entries with `hasPremises: false` are nearby towns we want to show up for; `nearest` is the clinic that serves them.
- Opening hours and online booking come from the SmileBook widget (iframe), so reception can change hours without a deploy.
- All 12 Google Business Profiles link to the homepage (`https://northgatedental.co.uk/`). The Book button on each profile goes to SmileBook.
- Review requests: `lib/reviews.ts` runs from the SmileBook "appointment completed" webhook.
