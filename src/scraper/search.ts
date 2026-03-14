import type { Page } from 'playwright-core';
import { browserManager } from '../browser/manager.js';
import type { CompanySearchResult } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Search for companies by name on the CBRD online search portal.
 */
export async function searchCompany(query: string, maxResults: number = 20): Promise<CompanySearchResult[]> {
  const page = await browserManager.getPage();

  // Ensure we're on the search page
  if (!page.url().includes('onlinesearch.mns.mu')) {
    await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });
  }

  // Wait for the page to be interactive
  await page.waitForLoadState(browserManager.waitUntil);

  // Find and fill the search input
  const searchInput = await findSearchInput(page);
  if (!searchInput) {
    throw new Error('Could not find search input on CBRD page. The page structure may have changed.');
  }

  // Clear and type the search query
  await searchInput.clear();
  await searchInput.fill(query);

  // Submit the search
  await submitSearch(page);

  // Wait for results to load
  await waitForResults(page);

  // Extract results from the page
  const results = await extractSearchResults(page, maxResults);

  return results;
}

async function findSearchInput(page: Page) {
  // Try multiple selectors for the search input
  const selectors = [
    'input[type="text"]',
    'input[type="search"]',
    'input[name*="search" i]',
    'input[name*="company" i]',
    'input[name*="name" i]',
    'input[placeholder*="search" i]',
    'input[placeholder*="company" i]',
    'input[placeholder*="name" i]',
    'input[id*="search" i]',
    'input[id*="company" i]',
    // Angular material inputs
    'mat-form-field input',
    'input.mat-input-element',
    // Generic first visible text input
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
  ];

  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
      return input;
    }
  }

  return null;
}

async function submitSearch(page: Page) {
  // Try multiple strategies to submit
  const buttonSelectors = [
    'button[type="submit"]',
    'button:has-text("Search")',
    'button:has-text("search")',
    'button:has-text("Find")',
    'button:has-text("Go")',
    'input[type="submit"]',
    '.search-btn',
    '[class*="search"] button',
    'mat-icon:has-text("search")',
  ];

  for (const selector of buttonSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
      return;
    }
  }

  // Fallback: press Enter on the search input
  await page.keyboard.press('Enter');
}

async function waitForResults(page: Page) {
  // Wait for results table or list to appear
  const resultSelectors = [
    'table tbody tr',
    'mns-table-library',
    '.search-results',
    '[class*="result"]',
    '[class*="table"]',
    'mat-table',
    '.mat-row',
    'ag-grid-angular',
    // Wait for any loading indicator to disappear
  ];

  // First wait for network to settle
  await page.waitForLoadState(browserManager.waitUntil).catch(() => {});

  // Then try to find result elements
  for (const selector of resultSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 10_000 });
      // Give a moment for rendering
      await page.waitForTimeout(1000);
      return;
    } catch {
      continue;
    }
  }

  // Fallback: just wait a bit for any dynamic content
  await page.waitForTimeout(3000);
}

async function extractSearchResults(page: Page, maxResults: number): Promise<CompanySearchResult[]> {
  // Try to extract results from the page using multiple strategies
  const results = await page.evaluate((max) => {
    const extracted: Array<{
      companyName: string;
      fileNumber: string;
      brn?: string;
      status?: string;
      type?: string;
    }> = [];

    // Strategy 1: Table rows
    const rows = document.querySelectorAll('table tbody tr, .mat-row, tr[class*="row"]');
    for (const row of Array.from(rows).slice(0, max)) {
      const cells = row.querySelectorAll('td, .mat-cell');
      if (cells.length >= 2) {
        extracted.push({
          companyName: cells[0]?.textContent?.trim() || '',
          fileNumber: cells[1]?.textContent?.trim() || '',
          brn: cells[2]?.textContent?.trim() || undefined,
          status: cells[3]?.textContent?.trim() || undefined,
          type: cells[4]?.textContent?.trim() || undefined,
        });
      }
    }

    // Strategy 2: List items or cards
    if (extracted.length === 0) {
      const items = document.querySelectorAll('[class*="result"], [class*="company"], [class*="item"], li');
      for (const item of Array.from(items).slice(0, max)) {
        const text = item.textContent?.trim() || '';
        if (text.length > 0) {
          // Try to parse structured data from the item
          const nameEl = item.querySelector('[class*="name"], h3, h4, strong, b, a');
          const fileEl = item.querySelector('[class*="file"], [class*="number"], [class*="id"]');

          extracted.push({
            companyName: nameEl?.textContent?.trim() || text.substring(0, 100),
            fileNumber: fileEl?.textContent?.trim() || '',
          });
        }
      }
    }

    // Strategy 3: Try shadow DOM (mns-table-library)
    if (extracted.length === 0) {
      const tableLib = document.querySelector('mns-table-library');
      if (tableLib?.shadowRoot) {
        const shadowRows = tableLib.shadowRoot.querySelectorAll('tr, [role="row"]');
        for (const row of Array.from(shadowRows).slice(1, max + 1)) { // skip header
          const cells = row.querySelectorAll('td, [role="cell"]');
          if (cells.length >= 2) {
            extracted.push({
              companyName: cells[0]?.textContent?.trim() || '',
              fileNumber: cells[1]?.textContent?.trim() || '',
              brn: cells[2]?.textContent?.trim() || undefined,
              status: cells[3]?.textContent?.trim() || undefined,
              type: cells[4]?.textContent?.trim() || undefined,
            });
          }
        }
      }
    }

    return extracted;
  }, maxResults);

  return results.filter(r => r.companyName.length > 0);
}
