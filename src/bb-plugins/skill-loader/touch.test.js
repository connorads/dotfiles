// Open BB with playwright-cli, then run-code --filename=touch.test.js.
// Uses the current page's BB origin. Marks and unmarks only; never loads or installs.
// eslint-disable-next-line no-unused-expressions -- playwright-cli evaluates this function as its entry point.
async page => {
  const results = [];
  for (const width of [320, 360, 390, 430, 1440]) {
    const touch = width !== 1440;
    const context = await page.context().browser().newContext({
      hasTouch: touch, isMobile: touch, viewport: { width, height: 1000 },
    });
    try {
      const p = await context.newPage();
      p.setDefaultTimeout(10000);
      await p.goto(page.url().split('/').slice(0, 3).join('/') + '/');
      const composer = p.locator('[contenteditable="true"]').last();
      await composer.waitFor();
      await p.waitForTimeout(2000);
      await composer.focus();
      await p.keyboard.press('Alt+s');
      const mark = p.getByRole('checkbox').first();
      await mark.waitFor();
      const rect = await mark.boundingBox();
      if (!rect || (touch && (rect.width < 44 || rect.height < 44))) {
        throw new Error(`${width}: mark hit area ${JSON.stringify(rect)}`);
      }
      const before = await mark.isChecked();
      // Tap the outer corners, beyond the old 28px square, rather than its centre.
      for (const [x, y] of [[rect.x + 2, rect.y + 2], [rect.x + rect.width - 2, rect.y + rect.height - 2]]) {
        if (touch) await p.touchscreen.tap(x, y);
        else await p.mouse.click(x, y);
      }
      if (await mark.isChecked() !== before) throw new Error(`${width}: corner taps did not toggle twice`);
      // Prove each tap changes the mark rather than both being ignored.
      if (touch) await p.touchscreen.tap(rect.x + 2, rect.y + 2);
      else await mark.click();
      if (await mark.isChecked() === before) throw new Error(`${width}: corner tap did not mark`);
      await mark.click();
      results.push({ width, touch, hitArea: { width: rect.width, height: rect.height }, passed: true });
    } finally { await context.close(); }
  }
  return results;
}
