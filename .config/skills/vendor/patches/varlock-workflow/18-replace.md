5. **Before commit** - run `varlock load --agent` and the repository's existing
   checks. Keep its secret scanner and hook manager, including hk. Do not install
   a competing hook with `varlock scan --install-hook`. Before adding Varlock's
   scanner, test a partially staged file and two synthetic secrets on one line;
   neither staged-blob coverage nor complete finding redaction follows from the
   `--staged` flag. Run `varlock audit` if you renamed keys or suspect drift.
