export type Theme = Record<string, string>;
const tokens = ["foreground", "background", "muted", "muted-foreground", "primary", "primary-foreground", "border", "ring", "destructive", "font-sans", "font-mono"];
export function readTheme(element: HTMLElement): Theme {
  const style = getComputedStyle(element);
  return Object.fromEntries([...tokens.map(token => [`--${token}`, style.getPropertyValue(`--${token}`).trim()]), ["font-family", style.fontFamily], ["color-scheme", style.colorScheme]]);
}

async function copyFontFace(css: string, baseUrl: string): Promise<string> {
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const url = new URL(match[1] ?? "", baseUrl);
    if (url.origin !== location.origin) continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Cannot load BB font");
    const blob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid font data"));
      reader.onerror = () => reject(new Error("Cannot read BB font"));
      reader.readAsDataURL(blob);
    });
    css = css.replace(match[0], `url("${data}")`);
  }
  return css;
}

// Font data stays in the frame; authored scripts cannot fetch host resources.
export async function fontStyles(): Promise<string> {
  const faces: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSFontFaceRule) {
          faces.push(await copyFontFace(rule.cssText, sheet.href ?? location.href));
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
    }
  }
  return faces.join("\n");
}

export function frameDocument(html: string, theme: Theme, fonts: string, nonce: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(policy);
  const style = doc.createElement("style");
  style.textContent = `${fonts}\n:root{${Object.entries(theme).map(([k,v]) => `${k}:${v.replace(/[<>]/g, "")}`).join(";")}}html{background:transparent!important}body{display:flow-root;min-height:0;margin:0;background:transparent!important;color:var(--foreground);font:14px/1.45 var(--font-sans)}button,input,select,textarea{font:inherit}*{box-sizing:border-box}`;
  policy.after(style);
  const script = doc.createElement("script");
  script.textContent = `(() => {
    const nonce = ${JSON.stringify(nonce)};
    let scheduled = 0;
    const report = () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(() => parent.postMessage({type:'visual-height',nonce,height:document.body.getBoundingClientRect().height}, '*')); };
    const observer = new ResizeObserver(report); observer.observe(document.body);
    const theme = event => {
      if(event.source !== parent || event.data?.type !== 'visual-theme' || event.data?.nonce !== nonce) return;
      for(const [key,value] of Object.entries(event.data.theme)) document.documentElement.style.setProperty(key,value);
      report();
    };
    addEventListener('message',theme); addEventListener('resize',report);
    document.fonts.ready.then(report); report();
    addEventListener('pagehide', () => { observer.disconnect(); cancelAnimationFrame(scheduled); removeEventListener('message',theme); removeEventListener('resize',report); }, {once:true});
  })();`;
  doc.body.append(script);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
