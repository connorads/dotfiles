**Non-JS apps/services:** use `varlock run -- <cmd>` to inject configuration.
Raw `load` output in shell, env or JSON formats can contain secrets; do not capture
it in agent context. Piped output redaction does not establish TTY redaction or
isolation from the child. See https://varlock.dev/integrations/other-languages/
