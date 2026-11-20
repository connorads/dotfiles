- A bug in raea itself (a command that fails or hangs, a wrong result, help that says one thing while raea does
  another), not in your composition: tell raea with `raea bug "WHAT'S WRONG" --text "what you did, expected, got"
  [--command CMD] [--error TEXT]`, or the feed's `bug_report` tool inside the app. Words only: paths, emails and keys
  are taken out before it's sent, and `--dry-run` shows what would go. Then carry on with a workaround.
