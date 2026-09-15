import { test, expect } from '@playwright/test';

test('search, filters, details, attribution, and empty state work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#result-count')).toContainText('1,123 stairways');
  await page.locator('[data-rating="5"]').click();
  await expect(page.locator('#result-count')).toContainText('80 stairways');
  await page.locator('#neighborhood-picker summary').click();
  await page.locator('#neighborhood-picker input[value="Bernal Heights"]').check();
  await expect(page.locator('.stair-card').first()).toBeVisible();
  await page.locator('.stair-card').first().click();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('.directions')).toHaveAttribute('href', /travelmode=walking/);
  await expect(page.locator('#detail a').filter({hasText:'View original photos'})).toHaveAttribute('href', /photos.app.goo.gl/);
  await page.locator('#search').fill('no-such-stairway-xyz');
  await expect(page.locator('#result-count')).toContainText('0 stairways');
  await expect(page.locator('#detail')).toBeHidden();
  await expect(page.locator('#surprise')).toBeDisabled();
  await page.locator('#empty-reset').click();
  await expect(page.locator('#result-count')).toContainText('1,123 stairways');
  await page.locator('#about-button').click();
  await expect(page.getByRole('dialog')).toContainText('Mary Burk and Adah Bakalinsky');
  await expect(page.getByRole('dialog')).toContainText('info@urbanhikersf.com');
  await expect(page.locator('.full-legend > div')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
});

test('photos load and mobile map stays inside the viewport', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('.featured img')).toBeVisible();
  await expect.poll(()=>page.locator('.featured img').evaluate((img: HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(()=>page.locator('.leaflet-tile-loaded').count()).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#search').fill('Tompkins');
  await page.locator('.stair-card').first().click();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('footer')).toContainText('made w/ <3 in sf');
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
});

test('route planner generates a route inside the selected neighborhood', async ({ page }) => {
  await page.goto('/');
  await page.locator('#route-toggle').click();
  await page.locator('#route-area').selectOption('neighborhood:Mission');
  await page.locator('#route-generate').click();
  await expect(page.locator('#route-output')).toBeVisible();
  await expect(page.locator('#route-stops li')).toHaveCount(4);
  await expect.poll(() => page.locator('#route-stops small').allTextContents().then(stops => stops.every(stop => stop.startsWith('Mission')))).toBe(true);
  await expect(page.locator('#route-directions')).toHaveAttribute('href', /travelmode=walking/);
});

test('route planner favors the best-rated stairways by default', async ({ page }) => {
  await page.goto('/');
  await page.locator('#route-toggle').click();
  await page.locator('#route-area').selectOption('neighborhood:Bernal Heights');
  await expect(page.locator('#route-preference')).toHaveValue('best');
  await page.locator('#route-generate').click();
  await expect.poll(() => page.locator('.route-rating').allTextContents()).toEqual(['★ 5', '★ 5', '★ 5', '★ 5']);
});

test('sheet-only locations never get invented coordinates', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('Glen Canyon Park. Coyote Crags Trail.');
  await page.locator('.stair-card').first().click();
  await expect(page.locator('#detail h2')).toContainText('Coyote Crags');
  await expect(page.locator('#detail')).toContainText('no matched map coordinates');
  await expect(page.locator('.directions')).toHaveCount(0);
  const url = page.url();
  await page.reload();
  await expect(page.locator('#detail h2')).toContainText('Coyote Crags');
  expect(page.url()).toBe(url);
});
