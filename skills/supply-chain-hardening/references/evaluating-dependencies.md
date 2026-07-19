# Evaluating supply-chain tooling

How to decide whether the local, open-source stack is enough — and what a
commercial product would actually add. The market sorts into a few axes;
knowing them turns "should we buy a scanner?" into a decision about which
gap, if any, you need closed.

## The default, and when to escalate

**Default: the local-OSS stack.** Age gates + script blocking + lockfile
pinning (preventive) and osv-scanner `MAL-*` matching (detective) cover the
attack classes behind the recent npm worm waves, run locally, cost nothing,
and send no telemetry. For an individual, a small team, or any project
without a private registry boundary, this is the answer — a vendor product
duplicates most of it.

**Escalate only when stated conditions hold:**

- You control a registry boundary (private proxy/mirror all installs go
  through) → a preventive proxy gate (firewall-style product) can block
  before download for the whole org, which no per-machine config achieves.
- Org scale makes per-repo config drift the dominant risk → centralised
  policy beats N hand-maintained configs.
- You need novel-malware detection beyond known advisories and accept the
  telemetry/SaaS trade-off → behavioural analysis is the one capability the
  local stack genuinely lacks.

## The axes

**Known-advisory matching vs behavioural detection.** Classic SCA matches
dependencies against known CVEs/advisories; behavioural products profile what
a package *does* (does this update suddenly touch the network, spawn shells,
read secrets?). The behavioural bet rests on a real gap: the large majority
of malicious packages are simply pulled by registries and never receive a
CVE, so an advisory matcher is blind to an attack in its first hours. The two
are complementary, not substitutes — OSV `MAL-*` matching narrows the gap
(malware advisories without CVEs) but still trails publication.

**Scan-after-the-fact vs secure-by-construction.** Scanners inspect what you
already pulled; rebuild vendors ship minimal, signed, near-zero-CVE artifacts
so there's less to find. Secure-by-construction maps to this skill's
structural layer — but it trades the open registry for a vendor's rebuild
cadence and catalogue, which is itself a dependency to evaluate.

**Flag-everything vs reachability.** Traditional SCA drowns teams in alerts
for vulnerabilities in code paths never called; reachability-based products
prioritise what your call graph can actually hit. This axis matters for CVE
*triage* noise — it does nothing for malware, where installation alone is
compromise. This is the buy-side mirror of the severity split in
[incident-response.md](incident-response.md): block malware, triage CVEs.

**Detective scan vs preventive proxy gate.** A scanner reports after
resolution; a registry-boundary firewall blocks the download itself — the
commercial enforcement of the age-gate/quarantine idea. Only meaningful if
all installs actually traverse the boundary.

**Local-OSS vs SaaS/telemetry.** Behavioural detection and org dashboards
require sending your dependency graph (sometimes install-time events) to the
vendor. That's a data-exfiltration surface and a vendor dependency in its own
right — weigh it as a cost, not a checkbox.

Caveat for all of the above: vendor noise-reduction and catch-rate figures
are self-reported marketing; no independent benchmark of "malware caught
before install" exists. Evaluate on mechanism, not percentages.

## Dependencies that aren't packages

The same reasoning applies to anything executable or instruction-shaped you
adopt: agent skills, MCP servers, editor extensions, GitHub Actions, base
images. Vendored skills and MCP servers are dependencies — pin them, review
them as executable content before first use, and diff on refresh exactly as
you would a lockfile change. Audits of public skill registries have found a
substantial fraction with security flaws, and registry malware incidents
have occurred (as of early 2026); novelty of the channel is not evidence of
safety.
