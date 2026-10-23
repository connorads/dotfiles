
  if [[ ! -d "$fixture_dir/remotion-src/node_modules" ]]; then
    echo "    ⏳ npm install (first run)"
    (cd "$fixture_dir/remotion-src" && npm install --silent --no-progress >/dev/null 2>&1)
  fi

  echo "    ⏳ render Remotion baseline"
  if ! (cd "$fixture_dir/remotion-src" && \
        npx --no-install remotion render "$composition_id" out/baseline.mp4 >/dev/null 2>&1); then
    echo "    ✗ Remotion render failed"
    write_result "$fixture_name" "fail" stage "remotion-render"
