---
name: hetzner-server
description: Create and manage Hetzner Cloud servers. Use when creating VPS/cloud servers, managing Hetzner infrastructure, or setting up dev/remote servers. Requires hcloud CLI.
---

# Hetzner Server

Create a small ARM dev server in Hetzner Cloud.

## Requirements

- `hcloud`
- `jq`
- `/Users/connorads/bin/hcloud-provision`

## Defaults

- Location: `fsn1`
- Image: `ubuntu-24.04`
- Server type: `cax33`
- Price: EUR 3.85/month
- Tool snapshot: hcloud CLI v1.42.0

## Create

Run this command:

```sh
/Users/connorads/bin/hcloud-provision --type cax33 --image ubuntu-24.04 --location fsn1
```

If the helper is unavailable, use:

```sh
hcloud server create --name dev-arm --type cax33 --image ubuntu-24.04 --location fsn1
```
