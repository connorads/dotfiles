const settingsUrl = 'https://ampcode.com/settings';

export function presentAmpUsage(text: string) {
  let account: string | null = null;
  let settings: string | null = null;
  const balances: { label: string; amount: string }[] = [];
  const details: string[] = [];
  for (const line of text.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)) {
    const signedIn = /^Signed in as (\S+)$/u.exec(line);
    if (signedIn) { account = signedIn[1]; continue; }
    const balance = /^((?:Individual|Workspace) credits): (\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?) remaining\b(.*)$/u.exec(line);
    if (balance) {
      balances.push({ label: balance[1], amount: balance[2] });
      let extra = balance[3].replace('(set up auto-reload to avoid running out)', '').trim();
      if (extra.endsWith(settingsUrl)) {
        settings = settingsUrl;
        extra = extra.slice(0, -settingsUrl.length).trim();
      }
      extra = extra.replace(/^\s*-\s*|\s*-\s*$/gu, '').trim();
      if (extra) details.push(extra);
      continue;
    }
    if (line === settingsUrl) { settings = settingsUrl; continue; }
    details.push(line);
  }
  return { account, balances, settingsUrl: settings, details };
}
