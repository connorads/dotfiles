#!/usr/bin/env node
// pnpm-build-scripts-check: every installed dependency carrying a lifecycle
// build script must have a recorded decision in pnpm-workspace.yaml
// `allowBuilds`. Undeclared ones pass locally and fail the first install that
// runs without a global ignoreScripts mask - CI, Cloudflare Workers Builds, a
// teammate's laptop - with ERR_PNPM_IGNORED_BUILDS.
//
//   node .hk-hooks/pnpm-build-scripts-check.mjs [--dir <project>] [--json]
//
//   exit 0  every build-script package has a decision (or the check can't
//           evaluate: no pnpm project, no node_modules - warn, never brick)
//   exit 1  at least one has none; the package and the YAML to add are named
//
// This reads config and manifests. It executes nothing and never installs:
// pnpm has no detect-without-execute mode, and the one local command that does
// reproduce the CI failure (`pnpm install --ignore-scripts=false`) re-enables
// the very scripts the posture blocks.
//
// Why not ask pnpm: `pnpm ignored-builds` and `node_modules/.modules.yaml`'s
// `ignoredBuilds`/`pendingBuilds` are computed under the machine's own
// ignoreScripts setting, so on a masked machine they report the mask, not the
// missing decision. Verified on pnpm 11.20.0: `.modules.yaml` carries no
// merged `allowBuilds` view at all, so the decisions are read from
// pnpm-workspace.yaml directly.
//
// Known limit: this reads the *installed* tree, so it sees the optional
// dependencies resolved for this platform. A postinstall that only exists in a
// linux-x64 package is invisible to any local check - closing that needs a CI
// job on the target platform.

import {
	existsSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
} from "node:fs";
import { basename, join } from "node:path";

const MAX_LISTED = 10;
const LIFECYCLE = ["preinstall", "install", "postinstall"];

function parseArgs(argv) {
	const opts = { dir: process.cwd(), json: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--json") opts.json = true;
		else if (argv[i] === "--dir") opts.dir = argv[++i] ?? opts.dir;
		else if (argv[i] === "--help" || argv[i] === "-h") opts.help = true;
		else {
			process.stderr.write(
				`pnpm-build-scripts-check: unknown argument: ${argv[i]}\n`,
			);
			process.exit(2);
		}
	}
	return opts;
}

// --- pnpm-workspace.yaml -----------------------------------------------------
// A hand-rolled reader for two shapes, so the check has no dependencies of its
// own (a supply-chain check that pulls in a YAML parser is its own joke):
//
//   allowBuilds:            allowBuilds: { esbuild: false }
//     esbuild: false
//
// plus pnpm 10's list-shaped onlyBuiltDependencies / ignoredBuiltDependencies,
// which are decisions too on a repo that hasn't migrated.

function stripComment(line) {
	const m = line.match(/(^|\s)#/);
	return m ? line.slice(0, m.index) : line;
}

function unquote(s) {
	const t = s.trim();
	if (
		(t.startsWith('"') && t.endsWith('"')) ||
		(t.startsWith("'") && t.endsWith("'"))
	) {
		return t.slice(1, -1);
	}
	return t;
}

function readDecisions(yamlPath) {
	if (!existsSync(yamlPath)) return /** @type {Set<string>} */ (new Set());
	const decided = /** @type {Set<string>} */ (new Set());
	const lines = readFileSync(yamlPath, "utf8").split("\n");

	let block = null; // "map" | "list"
	for (const raw of lines) {
		const line = stripComment(raw).replace(/\s+$/, "");
		if (!line.trim()) continue;

		const indented = /^\s/.test(line);
		if (!indented) {
			block = null;
			const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
			if (!m) continue;
			const [, key, rest] = m;
			if (key === "allowBuilds") {
				if (rest.startsWith("{")) {
					for (const entry of rest.replace(/^\{|\}\s*$/g, "").split(",")) {
						const name = entry.split(":")[0];
						if (name.trim()) decided.add(unquote(name));
					}
				} else if (!rest) {
					block = "map";
				}
			} else if (
				key === "onlyBuiltDependencies" ||
				key === "ignoredBuiltDependencies"
			) {
				if (rest.startsWith("[")) {
					for (const entry of rest.replace(/^\[|\]\s*$/g, "").split(",")) {
						if (entry.trim()) decided.add(unquote(entry));
					}
				} else if (!rest) {
					block = "list";
				}
			}
			continue;
		}

		if (block === "map") {
			const m = line.match(/^\s+(.+?)\s*:\s*\S*\s*$/);
			if (m) decided.add(unquote(m[1]));
		} else if (block === "list") {
			const m = line.match(/^\s+-\s*(.+?)\s*$/);
			if (m) decided.add(unquote(m[1]));
		}
	}
	return decided;
}

// --- installed tree ----------------------------------------------------------

function safeReaddir(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

// One level of node_modules: real package dirs plus @scope/ expansion.
function packageDirs(nodeModules) {
	const out = [];
	for (const entry of safeReaddir(nodeModules)) {
		if (entry.name.startsWith(".")) continue;
		const path = join(nodeModules, entry.name);
		if (entry.name.startsWith("@")) {
			for (const scoped of safeReaddir(path)) {
				if (!scoped.name.startsWith(".")) out.push(join(path, scoped.name));
			}
		} else {
			out.push(path);
		}
	}
	return out;
}

function collectPackages(projectDir) {
	const nodeModules = join(projectDir, "node_modules");
	const dirs = [...packageDirs(nodeModules)];

	// The isolated (default) linker keeps the real package dirs in the virtual
	// store and symlinks names into place; the hoisted linker doesn't have one.
	const virtualStore = join(nodeModules, ".pnpm");
	for (const entry of safeReaddir(virtualStore)) {
		if (!entry.isDirectory()) continue;
		dirs.push(...packageDirs(join(virtualStore, entry.name, "node_modules")));
	}

	const seen = new Set();
	const packages = [];
	for (const dir of dirs) {
		let real;
		try {
			real = realpathSync(dir);
		} catch {
			continue;
		}
		// A link out of node_modules is a workspace package: first-party code,
		// and not what allowBuilds governs.
		if (!real.split("/").includes("node_modules")) continue;
		if (seen.has(real)) continue;
		seen.add(real);

		const manifestPath = join(real, "package.json");
		let manifest;
		try {
			if (!statSync(manifestPath).isFile()) continue;
			manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		} catch {
			continue;
		}

		const triggers = LIFECYCLE.filter((s) => manifest.scripts?.[s]);
		// pnpm's other requiresBuild trigger: node-gyp builds a package with a
		// binding.gyp even when it declares no install script.
		if (existsSync(join(real, "binding.gyp"))) triggers.push("binding.gyp");
		if (triggers.length === 0) continue;

		packages.push({
			name: typeof manifest.name === "string" ? manifest.name : basename(real),
			version: typeof manifest.version === "string" ? manifest.version : "",
			triggers,
		});
	}
	return packages;
}

// --- report ------------------------------------------------------------------

function label(pkg) {
	return pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;
}

function skip(opts, reason) {
	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify({ status: "skipped", dir: opts.dir, reason })}\n`,
		);
	} else {
		process.stderr.write(`pnpm-build-scripts-check: ${reason}, skipping\n`);
	}
	process.exit(0);
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
	process.stdout.write(
		"usage: pnpm-build-scripts-check.mjs [--dir <project>] [--json]\n" +
			"\n" +
			"Fails when an installed dependency has a lifecycle build script with no\n" +
			"decision recorded in pnpm-workspace.yaml `allowBuilds`.\n",
	);
	process.exit(0);
}

if (!existsSync(opts.dir)) skip(opts, `${opts.dir} does not exist`);

const workspaceYaml = ["pnpm-workspace.yaml", "pnpm-workspace.yml"]
	.map((f) => join(opts.dir, f))
	.find((f) => existsSync(f));

if (!existsSync(join(opts.dir, "pnpm-lock.yaml")) && !workspaceYaml) {
	skip(opts, "not a pnpm project (no pnpm-lock.yaml or pnpm-workspace.yaml)");
}
if (!existsSync(join(opts.dir, "node_modules"))) {
	skip(opts, "node_modules absent (run 'pnpm install')");
}

const decided = readDecisions(
	workspaceYaml ?? join(opts.dir, "pnpm-workspace.yaml"),
);
const packages = collectPackages(opts.dir);
const undeclared = packages
	.filter((p) => !decided.has(p.name))
	.sort((a, b) => label(a).localeCompare(label(b)));

if (opts.json) {
	process.stdout.write(
		`${JSON.stringify({
			status: undeclared.length ? "fail" : "ok",
			dir: opts.dir,
			buildScriptPackages: packages.length,
			decided: [...decided].sort(),
			undeclared,
		})}\n`,
	);
	process.exit(undeclared.length ? 1 : 0);
}

if (undeclared.length === 0) process.exit(0);

const shown = undeclared.slice(0, MAX_LISTED);
const width = Math.max(...shown.map((p) => label(p).length));
const lines = [
	"",
	`pnpm build scripts with no recorded decision (${undeclared.length}):`,
	"",
	...shown.map((p) => `  ${label(p).padEnd(width)}  ${p.triggers.join(", ")}`),
];
if (undeclared.length > shown.length) {
	lines.push(`  ... and ${undeclared.length - shown.length} more`);
}
lines.push(
	"",
	"pnpm blocks these by default and fails closed (ERR_PNPM_IGNORED_BUILDS) on",
	"any install without a global ignoreScripts mask - CI, Cloudflare Workers",
	"Builds, a teammate's laptop. Record a decision per package in",
	"pnpm-workspace.yaml:",
	"",
	"  allowBuilds:",
	`    ${shown[0].name}: false   # false = acknowledged, deliberately not run`,
	"",
	"Use true only where the package genuinely needs its build (native module,",
	"codegen), and say why in a comment - that is the user's security decision.",
	"",
);
process.stderr.write(`${lines.join("\n")}\n`);
process.exit(1);
