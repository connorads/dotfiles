
  if [[ ! -d "$fixture_dir/remotion-src/node_modules" ]]; then
    echo "    error: Remotion dependencies missing; provision them through the local tool workflow" >&2
    write_result "$fixture_name" "fail" stage "missing-dependencies"
    return 0
  fi

  echo "    ⏳ render Remotion baseline"
  if ! (cd "$fixture_dir/remotion-src" && \
        pnpm exec remotion render "$composition_id" out/baseline.mp4 >/dev/null 2>&1); then
    echo "    ✗ Remotion render failed"
    write_result "$fixture_name" "fail" stage "remotion-render"
