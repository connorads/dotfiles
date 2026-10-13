#!/usr/bin/env node
// Lists installed UI components that no file in the showcase imports.
// Usage: node showcase-coverage.mjs <ui-dir> <showcase-dir...>
import { readdirSync, readFileSync, lstatSync } from "node:fs"
import { basename, extname, join, resolve } from "node:path"

const [uiArg, ...roots] = process.argv.slice(2)
