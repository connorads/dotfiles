  .map((file) => basename(file, extname(file)))

function walk(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return []
  if (stat.isFile()) {
    return [path]
  }

  if (!stat.isDirectory()) return []
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry)
    // Skip the ui directory so components don't count as using each other.
