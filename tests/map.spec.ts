import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test('featured stairway arrow cycles through three random choices', async ({ page }) => {
  await page.goto('/');
  const ids = [await page.locator('#featured').getAttribute('data-featured-id')];
  await page.locator('#featured .circle-arrow').click();
  ids.push(await page.locator('#featured').getAttribute('data-featured-id'));
  await page.locator('#featured .circle-arrow').click();
  ids.push(await page.locator('#featured').getAttribute('data-featured-id'));
  expect(new Set(ids).size).toBe(3);
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
  await expect.poll(() => page.locator('.stair-card img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
});

test('map location control starts the nearby-stairs flow', async ({ page }) => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 37.759, longitude: -122.435 });
  await page.goto('/');
  await page.locator('#locate').click();
  await expect(page.locator('.results-heading h2')).toHaveText('Stairs near you');
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

test('escalator scoring is deterministic and maps scores to the four tiers', async () => {
  const { assessStairway, tierFor, tiers } = await import('../src/escalator');
  const long = assessStairway({ name: 'Filbert Steps with bay views', rating: 5, steps: '200' });
  expect(long.score).toBeGreaterThanOrEqual(8);
  expect(long.score).toBeLessThanOrEqual(15);
  expect(long.tier).toBe('Immediate Escalation Advised');
  expect(long.glide).toBe('50 seconds of effortless glide.');
  expect(long.remark).toContain('200 steps represents 200 discrete opportunities for pedestrian hesitation.');
  expect(long.remark).toContain('The scenic value cited by users is not currently capturable as throughput.');
  expect(long.remark).toContain('Recommend immediate escalation.');
  expect(assessStairway({ name: 'Filbert Steps with bay views', rating: 5, steps: '200' })).toEqual(long);
  const short = assessStairway({ name: 'Bronte/Tompkins & Jarboe.', rating: 1, steps: '20' });
  expect(short.score).toBeGreaterThanOrEqual(80);
  expect(short.score).toBeLessThan(90);
  expect(short.tier).toBe('Monitor');
  expect(short.candidate).toBe(false);
  expect(assessStairway({ name: 'Tompkins/Putnam & Nevada. Mosaic!', rating: 5, steps: '66' }).tier).toBe('Priority Candidate');
  expect(assessStairway({ name: 'Somewhere', rating: 3, steps: '80' }).tier).toBe('Recommended');
  const fallback = assessStairway({ name: 'Unsurveyed', rating: 2, steps: '' });
  expect(fallback.provisional).toBe(true);
  expect(Number.isFinite(fallback.score)).toBe(true);
  expect(fallback.remark).toContain('provisional');
  expect(assessStairway({ name: 'Range', rating: 2, steps: '10-11' }).steps).toBe(10);
  expect([0, 31, 32, 44, 45, 64, 65, 100].map(tierFor)).toEqual(['Immediate Escalation Advised', 'Immediate Escalation Advised', 'Priority Candidate', 'Priority Candidate', 'Recommended', 'Recommended', 'Monitor', 'Monitor']);
  const { stairs } = JSON.parse(readFileSync(new URL('../src/stairs.json', import.meta.url), 'utf8')) as { stairs: { name: string; rating: number; steps: string }[] };
  const scored = stairs.map(assessStairway);
  for (const tier of tiers) expect(scored.some(entry => entry.tier === tier), `no stairway reaches ${tier}`).toBe(true);
  expect(scored.filter(entry => entry.candidate)).toHaveLength(82);
  expect(tiers).toEqual(['Monitor', 'Recommended', 'Priority Candidate', 'Immediate Escalation Advised']);
});

test('detail panel shows the escalator retrofit assessment and cards flag candidates', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('Tompkins');
  await expect(page.locator('.stair-card')).toHaveCount(2);
  await expect(page.locator('.stair-card .retrofit-flag')).toHaveCount(1);
  await page.locator('.stair-card').first().click();
  const assessment = page.locator('.escalator-assessment');
  await expect(assessment).toContainText('Escalator Retrofit Assessment');
  await expect(assessment.locator('#efficiency-score')).toHaveText('41 / 100');
  await expect(assessment.locator('#glide-time')).toHaveText('17 seconds of effortless glide.');
  await expect(assessment.locator('.retrofit-tier')).toHaveText('Priority Candidate');
  await expect(assessment.locator('.retrofit-tier')).toHaveAttribute('data-tier', 'priority-candidate');
  await expect(assessment.locator('.escalator-remark')).toContainText('Recommend inclusion in the next retrofit funding cycle.');
  await page.locator('.stair-card').nth(1).click();
  await expect(assessment.locator('.retrofit-tier')).toHaveText('Monitor');
  await expect(page.locator('.map-legend')).toContainText('Escalator retrofit candidates are flagged');
});

test('retrofit candidate filter narrows results and works from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('#retrofit-only').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#retrofit-only')).toBeChecked();
  await expect(page.locator('#result-count')).toContainText('82 stairways · 80 on the map');
  await expect(page.locator('.stair-card .retrofit-flag')).toHaveCount(45);
  await page.locator('[data-rating="2"]').click();
  await expect(page.locator('#result-count')).toContainText('0 stairways');
  await page.locator('#empty-reset').click();
  await expect(page.locator('#retrofit-only')).not.toBeChecked();
  await expect(page.locator('#result-count')).toContainText('1,123 stairways');
});
