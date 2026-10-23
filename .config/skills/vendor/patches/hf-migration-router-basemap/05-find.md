
// --no-sandbox is intentional: trusted Source-time bake, headless, often root/CI; deps are version-pinned above.
const browser = await puppeteer.launch({
