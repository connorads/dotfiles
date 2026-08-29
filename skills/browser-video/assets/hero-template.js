// Skeleton for `playwright-cli run-code --filename <this>`. Copy it next to the
// video you are recording and adapt; it is not imported.
//
// Before running it, in the same fresh session:
//   playwright-cli -s=<take> open <url>
//   playwright-cli -s=<take> video-show-actions        # otherwise: no pointer
//   playwright-cli -s=<take> run-code --filename hero.js
//
// The whole file is one expression, which is the form run-code expects.
// oxlint-disable-next-line no-unused-expressions
async page => {
  const OUT = '/absolute/path/to/take.webm'; // relative paths land in the CWD of the CLI server
  const URL = 'https://example.com/';
  const TEXT = 'the text to type';

  // A scaled iframe, if the target sits inside one. Delete both this and mapRect
  // when everything you touch is in the top-level page.
  const FRAME = 'iframe[title="..."]';

  await page.screencast.start({ path: OUT, size: { width: 1280, height: 720 } });

  await page.goto(URL);
  // Wait for something that only exists once the page is genuinely ready. A
  // timeout here is a failed take, which is the point: it fails loudly.
  await page.getByText('...').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);

  // --- geometry -------------------------------------------------------------

  // Top-level elements: boundingBox() is already viewport coordinates.
  const rectOf = async locator => {
    const b = await locator.boundingBox();
    if (!b) throw new Error('no bounding box - element not visible');
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };

  // Inside a CSS-transform-scaled iframe, boundingBox() is NOT corrected for the
  // transform. Read the element's own rect in the frame and map it through the
  // iframe's box in the page instead.
  const mapRect = async locator => {
    const ib = await page.locator(FRAME).boundingBox();
    const r = await locator.evaluate(el => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, vw: innerWidth };
    });
    const s = ib.width / r.vw;
    return { x: ib.x + r.x * s, y: ib.y + r.y * s, w: r.w * s, h: r.h * s };
  };

  const centre = r => [r.x + r.w / 2, r.y + r.h / 2];

  // Stepped move so the pointer travels visibly, then settles before the click.
  const glide = async ([x, y], steps = 28, settle = 500) => {
    await page.mouse.move(x, y, { steps });
    await page.waitForTimeout(settle);
  };

  // --- take -----------------------------------------------------------------

  await page.mouse.move(180, 660); // park the pointer off the action
  await page.screencast.showChapter('Chapter one', {
    description: 'What the viewer is about to see.',
    duration: 2600,
  });

  const frame = page.frameLocator(FRAME);
  const target = frame.getByText('...');
  const tr = await mapRect(target); // rectOf(...) outside a scaled frame

  await glide(centre(tr), 34, 1000);
  // Click by coordinate when the mapped point is what matters (an app that
  // anchors to whatever is under the cursor); locator.click() otherwise.
  await page.mouse.click(...centre(tr));
  await page.waitForTimeout(900);

  const box = page.getByRole('textbox', { name: '...' });
  await box.waitFor({ timeout: 10000 });
  await glide(centre(await rectOf(box)));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(350);
  await box.pressSequentially(TEXT, { delay: 55 });
  await page.waitForTimeout(900);

  const submit = page.getByRole('button', { name: '...' });
  await glide(centre(await rectOf(submit)), 22, 520);
  await page.mouse.down();
  await page.mouse.up();

  // Wait on the outcome, not a timeout: this is what makes the take self-checking.
  await page.getByRole('heading', { name: '...' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(700);

  // Highlight the result so the viewer knows where to look. Overlays are
  // pointer-events: none, so they never block an interaction.
  const cr = await rectOf(page.getByText(TEXT));
  await page.screencast.showOverlay(`
    <div style="position:absolute; top:${cr.y - 10}px; left:${cr.x - 12}px;
      width:${cr.w + 24}px; height:${cr.h + 20}px;
      border:2px solid #a78bfa; border-radius:10px;
      box-shadow:0 0 0 6px rgba(167,139,250,.16);"></div>`, { duration: 3200 });
  await glide([640, 620], 20, 2600);

  await page.screencast.showChapter('Chapter two', {
    description: 'What just happened, in one line.',
    duration: 2400,
  });

  await page.screencast.hideOverlays(); // nothing leaks into the next take
  await page.screencast.stop();
  return OUT;
}
