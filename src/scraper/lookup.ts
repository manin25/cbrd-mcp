import type { Page } from 'playwright-core';
import { browserManager } from '../browser/manager.js';
import type { CompanySearchResult } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Look up a company by file number or BRN.
 * Selects the appropriate radio button on the search form, then performs the search.
 * Does NOT delegate to searchCompany to avoid radio-button conflicts.
 */
export async function lookupCompany(fileNumber?: string, brn?: string): Promise<CompanySearchResult[]> {
  if (!fileNumber && !brn) {
    throw new Error('At least one of file_number or brn must be provided');
  }

  const page = await browserManager.getPage();

  // Always navigate fresh to ensure clean state (previous tool calls may leave
  // Turnstile overlays or Angular sub-routes that block interaction)
  await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });
  const searchInput = page.locator('#company-partnership-text-field');
  if (!await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    throw new Error('Could not find search input on CBRD page.');
  }

  // Select the appropriate radio button
  if (fileNumber) {
    const fileNoRadio = page.locator('#fileNo');
    if (await fileNoRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      const isChecked = await fileNoRadio.isChecked().catch(() => false);
      if (!isChecked) {
        await fileNoRadio.click();
        await page.waitForTimeout(300);
        console.log('Switched to File No. search mode');
      }
    }
  } else if (brn) {
    const brnRadio = page.locator('#brn');
    if (await brnRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      const isChecked = await brnRadio.isChecked().catch(() => false);
      if (!isChecked) {
        await brnRadio.click();
        await page.waitForTimeout(300);
        console.log('Switched to BRN search mode');
      }
    }
  }

  // Fill and submit
  const searchQuery = fileNumber || brn || '';
  await searchInput.clear();
  await searchInput.fill(searchQuery);

  // Click submit
  const searchBtn = page.locator('button[type="submit"]');
  if (await searchBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchBtn.first().click();
  }

  // Wait for actual data rows
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('lib-mns-universal-table table tbody tr');
      if (rows.length === 0) return false;
      return rows[0].querySelector('td[data-column="Name"]') !== null;
    }, { timeout: 15_000 });
    await page.waitForTimeout(500);
  } catch {
    console.log('No data rows found — lookup may have returned no results');
  }

  // Extract results
  const results = await page.evaluate((max) => {
    const extracted: Array<{
      companyName: string;
      fileNumber: string;
      brn?: string;
      status?: string;
      type?: string;
    }> = [];

    const table = document.querySelector('lib-mns-universal-table table');
    if (!table) return extracted;

    const rows = table.querySelectorAll('tbody tr');
    for (const row of Array.from(rows).slice(0, max)) {
      const nameCell = row.querySelector('td[data-column="Name"]');
      const fileNoCell = row.querySelector('td[data-column="File No."]');
      const categoryCell = row.querySelector('td[data-column="Category"]');
      const natureCell = row.querySelector('td[data-column="Nature"]');
      const statusCell = row.querySelector('td[data-column="Status"]');

      const companyName = nameCell?.textContent?.trim() || '';
      const fileNumber = fileNoCell?.textContent?.trim() || '';

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
  }, 10);

  console.log(`Lookup "${searchQuery}": found ${results.length} results`);
  return results;
}
