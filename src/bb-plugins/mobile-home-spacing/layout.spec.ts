import { expect, test, type Page } from '@playwright/test';
import { mountMobileHomeSpacing } from './layout';

// Host compact-home geometry. Inline offsets model the host's ResizeObserver.
async function home(page: Page, height: number, rows = 20, compact = true) {
  await page.setViewportSize({ width: 412, height });
  await page.setContent(`
    <style>
      body { margin: 0; }
      #home { position: relative; height: 100dvh; }
      #viewport { position: absolute; inset: 0; overflow-y: auto; }
      #content { display: flex; min-height: 100%; flex-direction: column; justify-content: end; }
      #offset { height: 60px; flex-shrink: 0; }
      #row-list > div { height: 60px; }
      #composer { position: absolute; bottom: 0; height: 180px; width: 100%; background: white; }
      #spacer { height: 180px; flex-shrink: 0; }
    </style>
    <main id="home" ${compact ? 'data-testid="root-compose-compact-home"' : ''}>
      <div id="viewport" data-testid="root-compose-compact-scroll-viewport" style="top:${Math.max(56, height - 534)}px">
        <div id="content" data-testid="root-compose-compact-scroll-content">
          <div id="offset" data-testid="root-compose-compact-recents-offset"></div>
          <section><header>Recent</header><div id="row-list">${Array.from({ length: rows }, (_, i) => `<div>Thread ${i + 1}</div>`).join('')}</div></section>
          <div id="spacer"></div>
        </div>
      </div>
      <div id="composer"><textarea aria-label="Prompt"></textarea></div>
    </main>`);
}

async function mount(page: Page) {
  await page.evaluate(`window.disposeSpacing = (${mountMobileHomeSpacing.toString()})(document)`);
}

for (const height of [568, 915]) {
  test(`Recent starts below controls at ${height}px and the last thread scrolls above the composer`, async ({ page }) => {
    await home(page, height);
    await mount(page);
    await expect(page.getByText('Recent', { exact: true })).toBeInViewport();
    expect((await page.locator('header').boundingBox())!.y).toBe(56);
    await page.locator('#viewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const last = (await page.getByText('Thread 20', { exact: true }).boundingBox())!;
    const composer = (await page.locator('#composer').boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(composer.y);
    expect(composer.y + composer.height).toBe(height);
  });
}

test('short lists stay at the top and host remeasurement cannot restore the gap', async ({ page }) => {
  await home(page, 915, 1);
  await mount(page);
  await page.locator('#viewport').evaluate(el => { el.style.top = '500px'; });
  expect((await page.locator('header').boundingBox())!.y).toBe(56);
  await page.setViewportSize({ width: 412, height: 568 });
  await page.locator('#composer').evaluate(el => { el.style.height = '260px'; });
  await page.locator('#spacer').evaluate(el => { el.style.height = '260px'; });
  expect((await page.locator('header').boundingBox())!.y).toBe(56);
  const composer = (await page.locator('#composer').boundingBox())!;
  expect(composer.y + composer.height).toBe(568);
});

test('desktop home remains unchanged', async ({ page }) => {
  await home(page, 915, 1, false);
  const before = await page.locator('header').boundingBox();
  await mount(page);
  expect(await page.locator('header').boundingBox()).toEqual(before);
});

test('disposal restores the host layout and a later home receives the styles', async ({ page }) => {
  await home(page, 915);
  const before = await page.locator('header').boundingBox();
  await mount(page);
  await page.evaluate('window.disposeSpacing()');
  expect(await page.locator('header').boundingBox()).toEqual(before);
  await page.setContent('<main></main>');
  await mount(page);
  await page.locator('main').evaluate(el => {
    el.outerHTML = '<div data-testid="root-compose-compact-home"><div data-testid="root-compose-compact-scroll-viewport" style="position:absolute;top:500px">Recent</div></div>';
  });
  expect(await page.getByText('Recent').evaluate(el => getComputedStyle(el).top)).toBe('56px');
});

test('last thread remains reachable after keyboard and composer resizing', async ({ page }) => {
  await home(page, 915);
  await mount(page);
  await page.getByRole('textbox', { name: 'Prompt' }).fill('A longer prompt');
  await page.setViewportSize({ width: 412, height: 568 });
  await page.locator('#composer').evaluate(el => { el.style.height = '260px'; });
  await page.locator('#spacer').evaluate(el => { el.style.height = '260px'; });
  await page.locator('#viewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const last = (await page.getByText('Thread 20', { exact: true }).boundingBox())!;
  const composer = (await page.locator('#composer').boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(composer.y);
  expect(composer.y + composer.height).toBe(568);
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('A longer prompt');
});
