export interface AwsProfile {
  name: string;
  /** The profile's `region`, or null when the config sets none. */
  region: string | null;
}

/**
 * Reads profile names and regions from an AWS config file. Only names and
 * regions leave this function: the file can hold account and role details the
 * picker does not need.
 */
export function parseProfiles(text: string): AwsProfile[] {
  const profiles: AwsProfile[] = [];
  let current: AwsProfile | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[\s*(.+?)\s*\]$/.exec(line);
    if (section) {
      const header = section[1]!;
      const name = header === 'default' ? 'default' : /^profile\s+(.+)$/.exec(header)?.[1]?.trim();
      // sso-session, services and other sections are not profiles.
      current = name ? { name, region: null } : null;
      if (current) profiles.push(current);
      continue;
    }
    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (current && pair && pair[1]!.toLowerCase() === 'region' && pair[2]) current.region = pair[2].trim();
  }
  return profiles;
}

/** The AWS config a thread reads: a region and nothing else, so no profile or credential lives there. */
export function regionConfig(region: string | null): string {
  return region ? `[default]\nregion = ${region}\n` : '';
}

/** AWS region names: letters, digits and hyphens, for example eu-west-1. */
export const REGION_PATTERN = /^[a-z]{2}(-[a-z0-9]+)+-\d+$/;
