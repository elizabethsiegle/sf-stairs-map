import { test, expect } from '@playwright/test';

test('search, filters, details, attribution, and empty state work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#result-count')).toContainText('1,123 stairways');
  await page.locator('[data-rating="5"]').click();
  await expect(page.locator('#result-count')).toContainText('80 stairways');
  await page.locator('#neighborhood').selectOption('Bernal Heights');
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

test('photo preview filter only shows stairways with visible preview images', async ({ page }) => {
  await page.goto('/');
  await page.locator('#photos-only').check();
  await expect(page.locator('#result-count')).toContainText('82 stairways');
  await expect(page.locator('.stair-card')).toHaveCount(45);
  await expect(page.locator('.stair-card .thumbnail img')).toHaveCount(45);
});

test('near me sorts mapped stairways by distance', async ({ page }) => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 37.759, longitude: -122.435 });
  await page.goto('/');
  await page.locator('#near-me').click();
  await expect(page.locator('.results-heading h2')).toHaveText('Stairs near you');
  await expect(page.locator('#result-count')).toContainText('sorted by distance');
  await expect(page.locator('.stair-card').first().locator('.nearby-distance')).toContainText('away');
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
