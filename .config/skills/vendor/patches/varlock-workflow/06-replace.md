- **Read and edit:** schema and non-secret configuration only when its contents
  are established as non-secret. Committed `.env` files can contain credentials;
  do not dump them into agent context. Use redacted diagnostics for unknown files.
