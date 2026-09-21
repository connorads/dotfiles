# SAFE alternatives
varlock load --agent    # JSON output, sensitive values redacted
varlock load            # human-readable, sensitive values masked
cat .env.schema         # schema only, no secret values
