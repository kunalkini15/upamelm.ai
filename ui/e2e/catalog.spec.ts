import { expect, test, type Page } from '@playwright/test';

type Bootstrap = {
  selection: { city: string; study: string; language: string };
  cities: Array<{ id: string; label: string; studyCount: number }>;
  studies: Array<{ id: string; title: string; languages: string[]; defaultLanguage: string }>;
  package: unknown;
};

async function bootstrap(page: Page, query = ''): Promise<Bootstrap> {
  const response = await page.request.get(`/api/v1/bootstrap${query}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('renders every discovered city, study, and language', async ({ page }) => {
  const first = await bootstrap(page);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    const errorText = request.failure()?.errorText;
    // Moving to the next matrix entry cancels any no-longer-needed request from
    // the previous document. Other first-party failures remain actionable.
    if (errorText !== 'net::ERR_ABORTED' && url.startsWith(new URL(page.url() || 'http://ui:5175').origin)) {
      failures.push(`request: ${url} ${errorText}`);
    }
  });

  let combinations = 0;
  for (const city of first.cities) {
    const cityPayload = await bootstrap(page, `?city=${encodeURIComponent(city.id)}`);
    expect(cityPayload.studies.length).toBe(city.studyCount);
    for (const study of cityPayload.studies) {
      for (const language of study.languages) {
        combinations += 1;
        const query = `?city=${encodeURIComponent(city.id)}&study=${encodeURIComponent(study.id)}&language=${encodeURIComponent(language)}`;
        await page.goto(`/${query}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Upamelm.ai', { exact: true })).toBeVisible();
        await expect(page.getByText('Failed to load scientific model')).toHaveCount(0);
        await expect(page.getByLabel('Select study')).toHaveValue(study.id);
        const languageSelect = page.getByLabel('Select language');
        if (study.languages.length > 1) await expect(languageSelect).toHaveValue(language);
      }
    }
  }
  expect(combinations).toBeGreaterThan(0);
  expect(failures, failures.join('\n')).toEqual([]);
});

test('language switching preserves the active supported view', async ({ page }) => {
  const first = await bootstrap(page);
  let target: { city: string; study: string; languages: string[] } | null = null;
  for (const city of first.cities) {
    const payload = await bootstrap(page, `?city=${encodeURIComponent(city.id)}`);
    const study = payload.studies.find((candidate) => candidate.languages.length > 1);
    if (study) { target = { city: city.id, study: study.id, languages: study.languages }; break; }
  }
  test.skip(!target, 'No multilingual study is available.');
  if (!target) return;

  const query = `?city=${encodeURIComponent(target.city)}&study=${encodeURIComponent(target.study)}&language=${encodeURIComponent(target.languages[0])}`;
  await page.goto(`/${query}`);
  const analysis = page.getByRole('button', { name: 'Analysis', exact: true });
  test.skip(await analysis.isDisabled(), 'Selected package has no report analysis.');
  await analysis.click();
  await expect(analysis).toHaveClass(/bg-accent-strong/);
  await page.getByLabel('Select language').selectOption(target.languages[1]);
  await expect(page).toHaveURL(new RegExp(`language=${target.languages[1]}`));
  await expect(analysis).toHaveClass(/bg-accent-strong/);
});

