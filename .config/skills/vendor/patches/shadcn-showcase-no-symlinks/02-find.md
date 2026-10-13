  .map((file) => basename(file, extname(file)))

function walk(path) {
  if (statSync(path).isFile()) {
    return [path]
  }

  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry)
    // Skip the ui directory so components don't count as using each other.
