# Pantry

Shared household stock list. Add an item and see what is in stock.

- `PORT=4310 pnpm dev` serves `src/` with a JSON API. Another service reads
  `GET /api/items` and `POST /api/items`.
