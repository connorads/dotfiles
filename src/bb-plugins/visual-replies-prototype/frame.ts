export type Theme = Record<string, string>;
const tokens = ["foreground", "background", "muted", "muted-foreground", "primary", "primary-foreground", "border", "ring", "destructive", "font-sans", "font-mono"];
export function readTheme(element: HTMLElement): Theme {
  const style = getComputedStyle(element);
  return Object.fromEntries([...tokens.map(token => [`--${token}`, style.getPropertyValue(`--${token}`).trim()]), ["font-family", style.fontFamily], ["color-scheme", style.colorScheme]]);
}

const fontNames = (stack = "") => stack.split(",").map(name => name.trim().replace(/^["']|["']$/g, "").toLowerCase());
const firstSource = /src:\s*(url\((?:"[^"]*"|'[^']*'|[^)]*)\)(?:\s*format\([^)]*\))?)[^;]*/;

async function copyFontFace(css: string, baseUrl: string): Promise<string> {
  css = css.replace(firstSource, "src: $1");
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

function sheetRules(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return Array.from(sheet.cssRules);
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") return [];
    throw error;
  }
}

async function copyFontFaces(families: Set<string>): Promise<string> {
  const faces: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of sheetRules(sheet)) {
      if (!(rule instanceof CSSFontFaceRule) || !fontNames(/font-family:\s*([^;]+)/.exec(rule.cssText)?.[1]).some(name => families.has(name))) continue;
      const face = await copyFontFace(rule.cssText, sheet.href ?? location.href).catch(() => null);
      if (face) faces.push(face);
    }
  }
  return faces.join("\n");
}

const fontCache = new Map<string, Promise<string>>();
// Font data stays in the frame; authored scripts cannot fetch host resources.
// Only theme families are copied: host sheets also declare KaTeX faces that frames never use.
export function fontStyles(theme: Theme): Promise<string> {
  const families = new Set([...fontNames(theme["--font-sans"]), ...fontNames(theme["--font-mono"])]);
  const key = [...families].join(",");
  let styles = fontCache.get(key);
  if (!styles) fontCache.set(key, styles = copyFontFaces(families));
  return styles;
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
    const sendHeight = () => parent.postMessage({type:'visual-height',nonce,height:document.body.getBoundingClientRect().height}, '*');
    const report = () => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(sendHeight); };
    const observer = new ResizeObserver(report); observer.observe(document.body);
    const theme = event => {
      if(event.source !== parent || event.data?.type !== 'visual-theme' || event.data?.nonce !== nonce) return;
      for(const [key,value] of Object.entries(event.data.theme)) document.documentElement.style.setProperty(key,value);
      report();
    };
    addEventListener('message',theme); addEventListener('resize',report);
    // Offscreen frames suspend animation callbacks; initial sizing must run directly.
    document.fonts.ready.then(report); sendHeight();
    addEventListener('pagehide', () => { observer.disconnect(); cancelAnimationFrame(scheduled); removeEventListener('message',theme); removeEventListener('resize',report); }, {once:true});
  })();`;
  doc.body.append(script);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
