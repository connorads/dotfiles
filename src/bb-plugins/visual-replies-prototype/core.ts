export function clearanceMinutes(arrivals: number, rate: number, workers: number, backlog: number): number | null {
  if (backlog === 0) return 0;
  const spare = rate * workers - arrivals;
  return spare > 0 ? backlog / spare : null;
}

export function acceptHeight(source: unknown, frame: unknown, data: unknown, nonce: string): number | null {
  if (!frame || source !== frame || typeof data !== "object" || data === null) return null;
  if (!("type" in data) || data.type !== "visual-height" || !("nonce" in data) || data.nonce !== nonce) return null;
  if (!("height" in data) || typeof data.height !== "number" || !Number.isFinite(data.height) || data.height < 0) return null;
  return Math.max(1, Math.min(1200, Math.ceil(data.height)));
}
