Do not read `.env` or `.env.local` directly. Instead run `varlock load` to show masked values, or read `.env.schema` to show the schema. Explain that reading env files directly could expose secrets.
