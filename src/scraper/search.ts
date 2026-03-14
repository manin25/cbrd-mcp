import type { Page } from 'patchright-core';
import { browserManager } from '../browser/manager.js';
import type { CompanySearchResult } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Search for companies by name on the CBRD online search portal.
 * Uses browser automation to interact with the public website.
 */
export async function searchCompany(query: string, maxResults: number = 20): Promise<CompanySearchResult[]> {
  const page = await browserManager.getPage();

  // Always navigate fresh to ensure clean state (previous tool calls may leave
  // Turnstile overlays or Angular sub-routes that block interaction)
  await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });
  const searchInput = page.locator('#company-partnership-text-field');
  if (!await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    throw new Error('Could not find search input on CBRD page. The page structure may have changed.');
  }

  // Only click the Company/Partnership Name radio if it's not already selected.
  // Clicking an already-selected radio triggers Angular change events that reset the form.
  const companyRadio = page.locator('#company-partnership');
  if (await companyRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
    const isChecked = await companyRadio.isChecked().catch(() => true);
    if (!isChecked) {
      await companyRadio.click();
      await page.waitForTimeout(300);
    }
  }

  await searchInput.clear();
  await searchInput.fill(query);

  // Click the Search submit button
  await submitSearch(page, searchInput);

  // Wait for results table to populate
  await waitForResults(page);

  // Extract results from the page
  const results = await extractSearchResults(page, maxResults);
  console.log(`Search "${query}": found ${results.length} results`);

  return results;
}

async function submitSearch(page: Page, searchInput: ReturnType<Page['locator']>) {
  // Primary: the specific search button
  const searchBtn = page.locator('button[type="submit"].search-business-partnership-btn');
  if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchBtn.click();
    return;
  }

  // Fallback: any submit button
  const fallbackBtn = page.locator('button[type="submit"]');
  if (await fallbackBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await fallbackBtn.first().click();
    return;
  }

  // Last resort: press Enter
  await searchInput.press('Enter');
}

async function waitForResults(page: Page) {
  // Wait for actual data rows (not the "No result to display" placeholder).
  // Data rows have td elements with data-column="Name".
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('lib-mns-universal-table table tbody tr');
      if (rows.length === 0) return false;
      return rows[0].querySelector('td[data-column="Name"]') !== null;
    }, { timeout: 15_000 });
    // Brief pause for Angular rendering to complete
    await page.waitForTimeout(500);
  } catch {
    // May be no results — that's okay
    console.log('No data rows found within timeout — search may have returned no results');
  }
}

async function extractSearchResults(page: Page, maxResults: number): Promise<CompanySearchResult[]> {
  // The CBRD results table uses <td data-column="..."> attributes for each column.
  // Columns: #, Name, File No., Category, Incorporation/Registration Date, Nature, Status, Action
  const results = await page.evaluate((max) => {
    const extracted: Array<{
      companyName: string;
      fileNumber: string;
      brn?: string;
      status?: string;
      type?: string;
    }> = [];

    // Target the results table inside lib-mns-universal-table
    const table = document.querySelector('lib-mns-universal-table table');
    if (!table) return extracted;

    const rows = table.querySelectorAll('tbody tr');
    for (const row of Array.from(rows).slice(0, max)) {
      // Use data-column attributes for reliable column identification
      const nameCell = row.querySelector('td[data-column="Name"]');
      const fileNoCell = row.querySelector('td[data-column="File No."]');
      const categoryCell = row.querySelector('td[data-column="Category"]');
      const natureCell = row.querySelector('td[data-column="Nature"]');
      const statusCell = row.querySelector('td[data-column="Status"]');

      const companyName = nameCell?.textContent?.trim() || '';
      const fileNumber = fileNoCell?.textContent?.trim() || '';

      // Skip empty or placeholder rows
      if (!companyName || !fileNumber || companyName === 'No result to display') {
        continue;
      }

      extracted.push({
        companyName,
        fileNumber,
        status: statusCell?.textContent?.trim() || undefined,
        type: `${categoryCell?.textContent?.trim() || ''} ${natureCell?.textContent?.trim() || ''}`.trim() || undefined,
      });
    }

    return extracted;
  }, maxResults);

  return results;
}
