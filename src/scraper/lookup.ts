import { browserManager } from '../browser/manager.js';
import type { CompanySearchResult } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Look up a company by file number or BRN.
 */
export async function lookupCompany(fileNumber?: string, brn?: string): Promise<CompanySearchResult[]> {
  if (!fileNumber && !brn) {
    throw new Error('At least one of file_number or brn must be provided');
  }

  const page = await browserManager.getPage();

  // Navigate to the search page
  if (!page.url().includes('onlinesearch.mns.mu')) {
    await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });
  }

  await page.waitForLoadState(browserManager.waitUntil);

  // Try to find a file number / BRN specific search field
  const searchQuery = fileNumber || brn || '';

  // Look for specific search mode selector (tabs, dropdowns, radio buttons)
  if (fileNumber) {
    // Try to switch to file number search mode
    const fileNoTab = page.locator('[class*="file"], [class*="number"], [data-tab*="file"], label:has-text("File No"), label:has-text("Company No"), option:has-text("File"), option:has-text("Number")');
    if (await fileNoTab.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await fileNoTab.first().click();
      await page.waitForTimeout(500);
    }
  } else if (brn) {
    // Try to switch to BRN search mode
    const brnTab = page.locator('[class*="brn"], [data-tab*="brn"], label:has-text("BRN"), label:has-text("Business Registration"), option:has-text("BRN")');
    if (await brnTab.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await brnTab.first().click();
      await page.waitForTimeout(500);
    }
  }

  // Use the search scraper with the file number/BRN as the query
  const { searchCompany } = await import('./search.js');
  const results = await searchCompany(searchQuery, 10);

  return results;
}
