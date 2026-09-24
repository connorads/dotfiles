#!/usr/bin/env bats

# pwa-check.mjs CLI contract: exit 0 clean or warnings only, 1 on any FAIL, 2 on
# usage error. Fixtures are built per test; PNGs carry only the IHDR the checker
# reads.

setup() {
	SCRIPT="$BATS_TEST_DIRNAME/../scripts/pwa-check.mjs"
	DIST="$BATS_TEST_TMPDIR/dist"
	mkdir -p "$DIST/icons" "$DIST/shots"
	png 192 192 "$DIST/icons/192.png"
	png 512 512 "$DIST/icons/512.png"
	png 1280 720 "$DIST/shots/wide.png"
	printf '<!doctype html><link rel="manifest" href="/manifest.webmanifest"><script src="/registerSW.js"></script>\n' >"$DIST/index.html"
	printf "navigator.serviceWorker.register('/sw.js', { scope: '/' })\n" >"$DIST/registerSW.js"
	printf 'self.addEventListener("install",()=>{})\n' >"$DIST/sw.js"
	manifest '[{"src":"/icons/192.png","sizes":"192x192","type":"image/png"},{"src":"/icons/512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]' \
		'[{"src":"/shots/wide.png","sizes":"1280x720","type":"image/png","form_factor":"wide"}]'
}

png() {
	node -e '
const [w, h, out] = process.argv.slice(1);
const b = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
b.writeUInt32BE(13, 8); b.write("IHDR", 12);
b.writeUInt32BE(+w, 16); b.writeUInt32BE(+h, 20);
require("fs").writeFileSync(out, b);' "$1" "$2" "$3"
}

manifest() {
	printf '{"id":"/","name":"Fixture","start_url":"/","display":"standalone","icons":%s,"screenshots":%s}\n' "$1" "$2" >"$DIST/manifest.webmanifest"
}

@test "passes a conforming build" {
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 0 ]
	[[ "$output" != *"FAIL"* ]]
}

@test "fails a maskable-only icon set" {
	manifest '[{"src":"/icons/512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]' '[]'
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL icons"* ]]
}

@test "fails when the largest any icon is under 144px" {
	png 143 143 "$DIST/icons/143.png"
	manifest '[{"src":"/icons/143.png","sizes":"143x143","type":"image/png"}]' '[]'
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 1 ]
	[[ "$output" == *"144"* ]]
}

@test "warns when an icon file's real size differs from its declared size" {
	png 100 100 "$DIST/icons/192.png"
	run node "$SCRIPT" --dir "$DIST"
	[[ "$output" == *"WARN icons"* ]]
	[[ "$output" == *"100x100"* ]]
}

@test "fails when the registered service worker is not in the output dir" {
	rm "$DIST/sw.js"
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL service-worker"* ]]
	[[ "$output" == *"/sw.js"* ]]
}

@test "finds a workbox-window registration in minified client code" {
	rm "$DIST/registerSW.js" "$DIST/sw.js"
	mkdir -p "$DIST/assets"
	printf 'import(`./workbox-window.js`).then(({Workbox:e})=>new e(`/sw.js`,{scope:`/`,type:`classic`}))\n' >"$DIST/assets/index-abc.js"
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL service-worker"* ]]
}

@test "warns when there are no screenshots" {
	manifest '[{"src":"/icons/192.png","sizes":"192x192","type":"image/png"}]' '[]'
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 0 ]
	[[ "$output" == *"WARN screenshots"* ]]
}

@test "warns on a screenshot outside the 2.3 aspect limit" {
	png 3000 1000 "$DIST/shots/wide.png"
	manifest '[{"src":"/icons/192.png","sizes":"192x192","type":"image/png"}]' \
		'[{"src":"/shots/wide.png","sizes":"3000x1000","type":"image/png","form_factor":"wide"}]'
	run node "$SCRIPT" --dir "$DIST"
	[[ "$output" == *"WARN screenshots"* ]]
	[[ "$output" == *"2.3"* ]]
}

@test "fails display_override that starts with browser" {
	printf '{"id":"/","name":"F","start_url":"/","display":"standalone","display_override":["browser"],"icons":[{"src":"/icons/192.png","sizes":"192x192","type":"image/png"}]}\n' >"$DIST/manifest.webmanifest"
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 1 ]
	[[ "$output" == *"FAIL display"* ]]
}

@test "warns on an unknown purpose token, which drops the icon" {
	manifest '[{"src":"/icons/192.png","sizes":"192x192","type":"image/png"},{"src":"/icons/512.png","sizes":"512x512","type":"image/png","purpose":"maskabel"}]' '[]'
	run node "$SCRIPT" --dir "$DIST"
	[[ "$output" == *"maskabel"* ]]
}

@test "reports a navigateFallback denylist that names only /api" {
	printf 'e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//]}))\n' >"$DIST/sw.js"
	run node "$SCRIPT" --dir "$DIST"
	[[ "$output" == *"WARN navigate-fallback"* ]]
}

@test "finds a manifest with no HTML link when the head is rendered at runtime" {
	rm "$DIST/index.html"
	run node "$SCRIPT" --dir "$DIST"
	[ "$status" -eq 0 ]
	[[ "$output" == *"manifest.webmanifest"* ]]
}

@test "--json emits parseable results" {
	run node "$SCRIPT" --dir "$DIST" --json
	[ "$status" -eq 0 ]
	echo "$output" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!Array.isArray(r.results))process.exit(1)'
}

@test "exits 2 with usage when no target is given" {
	run node "$SCRIPT"
	[ "$status" -eq 2 ]
	[[ "$output" == *"usage"* ]]
}

@test "--url reports the service worker's headers and warns on a long max-age" {
	PORT=$((20000 + RANDOM % 20000))
	node -e '
require("http").createServer((q, s) => {
  if (q.url === "/sw.js") { s.writeHead(200, {"content-type": "text/javascript", "cache-control": "public, max-age=86400"}); return s.end("//"); }
  if (q.url === "/manifest.webmanifest") { s.writeHead(200, {"content-type": "application/manifest+json"}); return s.end("{}"); }
  s.writeHead(200, {"content-type": "text/html"}); s.end("<link rel=manifest href=/manifest.webmanifest>");
}).listen(+process.argv[1], "127.0.0.1");' "$PORT" &
	SERVER=$!
	sleep 0.5
	run node "$SCRIPT" --dir "$DIST" --url "http://127.0.0.1:$PORT/"
	kill "$SERVER"
	[[ "$output" == *"max-age=86400"* ]]
	[[ "$output" == *"WARN sw-headers"* ]]
}
