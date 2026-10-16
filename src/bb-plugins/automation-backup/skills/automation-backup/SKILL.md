---
name: automation-backup
description: Inspect or run private Git backups of BB automation definitions.
---

# Automation Backup

Use `bb automation-backup run` to export, commit and push live definitions now.
Use `bb automation-backup status` to see the last outcome.
Use `bb plugin logs automation-backup` to inspect failures.

The plugin runs on the BB server at startup and every hour while enabled.
Its `directory` and `repository` settings select a dedicated private Git checkout
and GitHub repository. Read the plugin README before changing configuration.

BB is authoritative. Snapshot edits never change live tasks. Preserve dirty Git
state, rejected local commits and another writer's lock. Never force a push or
clear a lock without inspecting the owner. Do not copy private snapshots into
public repositories or include their content in diagnostic output.
