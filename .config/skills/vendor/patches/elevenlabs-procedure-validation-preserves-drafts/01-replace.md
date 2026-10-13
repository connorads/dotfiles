Validate structured content locally before any service write. Parse the candidate JSON and check the documented procedure rules. Local parsing does not prove server compilation or branch-wide validation.

```bash
python3 -m json.tool procedure-content.json > /dev/null
```

Server compilation requires a separately authorised draft save or publish. Saving a full agent draft can replace unrelated unsaved work. Do not POST an agent draft or DELETE a draft merely to validate. Before a requested save, verify the draft endpoint semantics against current official documentation, read the current draft, preserve all fields and pending edits, and resolve concurrent writers. If preservation cannot be established, report server validation as unavailable and keep the local candidate. Never discard a pre-existing draft as cleanup. Publishing versions every pending procedure draft on the branch, so confirm that all pending changes belong to the authorised publication scope.

