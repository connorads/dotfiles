  echo "    ⏳ render HF translation"
  if ! (cd "$fixture_dir" && \
        hyperframes render hf-src/ --output hf.mp4 --quiet >/dev/null 2>&1); then
    echo "    ✗ HF render failed"
    write_result "$fixture_name" "fail" stage "hf-render"
