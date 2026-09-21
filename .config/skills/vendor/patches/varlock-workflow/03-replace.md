Keep `.env.schema` limited to schema, non-secret defaults and provider references.
A filename or Git tracking status does not establish that a file contains no
secrets. Use `varlock load --agent` for diagnostics; redaction depends on correct
sensitivity metadata. The child process still receives resolved secrets.
