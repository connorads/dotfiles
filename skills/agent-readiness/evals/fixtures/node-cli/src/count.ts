export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
