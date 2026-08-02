// Render a deterministic ASCII tree from a flat list of relative file paths.
// Pure and unit-testable — reuses the file list the glob already produced, so
// there's no shelling out to `tree`.

interface Node {
  readonly name: string;
  readonly children: Map<string, Node>;
}

const makeNode = (name: string): Node => ({ name, children: new Map() });

const sortedChildren = (node: Node): readonly Node[] =>
  [...node.children.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const renderNodes = (nodes: readonly Node[], prefix: string): string[] => {
  const lines: string[] = [];
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1;
    lines.push(`${prefix}${last ? "└── " : "├── "}${node.name}`);
    const childPrefix = `${prefix}${last ? "    " : "│   "}`;
    lines.push(...renderNodes(sortedChildren(node), childPrefix));
  });
  return lines;
};

export const renderTree = (relPaths: readonly string[]): string => {
  const root = makeNode("");
  for (const relPath of relPaths) {
    const parts = relPath.split("/").filter((p) => p.length > 0);
    let cursor = root;
    for (const part of parts) {
      const existing = cursor.children.get(part);
      if (existing !== undefined) {
        cursor = existing;
      } else {
        const created = makeNode(part);
        cursor.children.set(part, created);
        cursor = created;
      }
    }
  }
  return renderNodes(sortedChildren(root), "").join("\n");
};
