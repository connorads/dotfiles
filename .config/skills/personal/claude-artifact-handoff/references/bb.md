# BB terminal adapter

Commands below use POSIX shell syntax. Check `command -v bb` and `command -v claude` on the execution host.
If either is absent, report the missing binary instead of installing it.

## Launch

1. Run `bb status --json` to resolve the current environment's host ID.
   Run `bb guide terminal` to check the installed command contract.
2. Create a fresh job directory under `BB_THREAD_STORAGE` and prepare the request and source there.
   Confirm that directory exists on the selected host. If execution is remote, check its binaries and paths there.
3. Set `artifact_host`, `artifact_job_dir`, and `artifact_prompt` from those resolved values.
   The prompt follows the contract and explicitly requests publishing, including the target URL for an update.
4. Start interactive Claude with the prompt as an argument:

   ```sh
   bb terminal create --machine "$artifact_host" --cwd "$artifact_job_dir" \
     --title 'Claude Artifact handoff' --cols 140 --rows 40 --json \
     -- claude "$artifact_prompt"
   ```

Use machine scope when the job needs its own working directory.
Thread-scoped terminals start in the environment directory and do not accept `--cwd`.
Do not add `-p`: this recipe needs an interactive Claude session.
Record the returned terminal ID as `artifact_terminal`.

## Observe and respond

Read bounded terminal output and check for a result file or a blocked prompt:

```sh
bb terminal output "$artifact_terminal" --tail-bytes 8000
```

Poll for at most two minutes per operation, keeping each wait below 60 seconds.
If the job remains active, report its state before extending the window.
Interactive Claude remains open after a turn, so process exit is not the completion signal.

Inspect trust and permission prompts before responding. Trust only the prepared directory after inspecting its contents.
Do not automatically approve broader access or change permission settings to make the recipe pass.

For a follow-up request, send the text and submit it in separate calls:

```sh
bb terminal send "$artifact_terminal" --text "$artifact_prompt"
bb terminal send "$artifact_terminal" --text '' --enter
```

Confirm the prompt leaves the composer before waiting for a result.
The spike required a later carriage return when a combined text/Enter send left the prompt unsent.
If necessary, send Enter again after checking that no request is running.

If automatic review rejects a request hidden in a brief, restate the authorised action directly once.
If review still rejects the explicit request, report the rejection and leave permission decisions to the user.

## Collect and close

Validate the result using the contract, then capture the supporting native tool events.
`Ctrl+O` expands Claude's transcript when tool events are collapsed:

```sh
bb terminal send "$artifact_terminal" --text "$(printf '\017')"
bb terminal output "$artifact_terminal" --tail-bytes 24000
bb terminal close "$artifact_terminal"
```

Keep result files under thread storage and return the artifact URL to the originating conversation.
Do not parse ANSI terminal redraws as a structured protocol.
Closing the session ends its opportunity to receive comments; it does not create a return channel to the originating agent.
