---
name: granted-aws
description: >-
  Sets up and uses AWS credentials through granted.dev's `assume`. Use when
  configuring AWS CLI or console access with granted, adding IAM-user access
  keys to the OS keychain, running `granted sso populate` for Identity Center,
  choosing between the IAM-user and SSO flows, opening the AWS console in a
  specific browser profile, or debugging `assume` / `granted credentials add`
  errors like "no such file or directory" on ~/.aws/config or "region not set
  on profile". Not for plain aws-cli profile config unrelated to granted.
---

# granted-aws

granted.dev's `assume` gives short-lived AWS creds and console access without
plaintext keys on disk. The tool is marketed for SSO, but works for plain
IAM users too. First-run fails in three specific ways that no error message
explains well - this skill is those three, plus picking the right flow.

## Pick the flow from the sign-in URL

The URL you log into decides everything. Check it first:

| URL shape | World | Flow |
|---|---|---|
| `https://<account-id>.signin.aws.amazon.com/console` | IAM user or root, one account | IAM-user flow |
| `https://<subdomain>.awsapps.com/start` | IAM Identity Center (SSO) | SSO flow |

A gist or doc that opens with `granted sso populate` assumes the second URL.
Running it against the first gets you nowhere - there's no SSO to populate.

Requires `granted`/`assume` and `aws` on PATH (`brew install common-fate/granted/granted awscli`).

## IAM-user flow (long-lived key → keychain)

granted stores the secret in the OS keychain and writes only a
`credential_process` line to `~/.aws/config` - no plaintext key on disk.

1. **Mint the key in the console.** IAM → Users → *your user* → Security
   credentials → Create access key (CLI). Never create keys for **root**; put
   MFA on the IAM user - a long-lived key with no MFA is the weak point.
2. **Point granted at your browser** (one-off): `granted browser set`.
3. **Create `~/.aws/config` first** - `granted credentials add` errors with
   `open ~/.aws/config: no such file or directory` if it's absent:

   ```sh
   mkdir -p ~/.aws && touch ~/.aws/config
   ```

4. **Add the key to the keychain:**

   ```sh
   granted credentials add          # prompts: profile name, Access Key ID, Secret
   ```

   Then delete the console tab showing the secret. Check with
   `granted credentials list`; re-run is `granted credentials update <profile>`.
5. **Set a region** - `assume <profile>` errors `region not set on profile`
   until one exists:

   ```sh
   aws configure set region <region> --profile <profile>   # e.g. eu-west-2
   ```

6. **Verify:**

   ```sh
   assume <profile>
   aws sts get-caller-identity        # prints the account + user ARN
   exit
   ```

7. **Console from the CLI, in a chosen browser profile:**

   ```sh
   assume <profile> -c --browser-profile "<profile-dir>"
   ```

   Find `<profile-dir>` at `chrome://version` → Profile Path → last path
   segment (e.g. `Default`, `Profile 3`). To skip the flag each time, set a
   default in `~/.granted/config`.

## SSO flow (no long-lived keys)

```sh
granted sso populate --sso-region <region> https://<subdomain>.awsapps.com/start
assume            # pick a profile; short-lived creds, nothing stored long-term
```

`granted sso populate` writes a profile per account+permission-set into
`~/.aws/config`. Console open is the same `assume <profile> -c` as above.

## Upgrade IAM-user → SSO later

No rework of console/browser setup needed:

```sh
granted sso populate --sso-region <region> https://<subdomain>.awsapps.com/start
granted credentials remove <profile>     # drop the keychain-stored long-lived key
```

Then delete that access key in the IAM console. Now zero long-lived secrets.
