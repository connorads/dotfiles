// Tiny shared text helper. Lives apart from display/pointer so both can flatten
// frontmatter strings (which may span lines) without one importing the other.

/** Collapse any whitespace run (incl. newlines) to a single space. */
export const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();
