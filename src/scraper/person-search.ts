import { browserManager } from '../browser/manager.js';
import type { PersonSearchResult } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Search for a person's name across CBRD company records.
 *
 * Note: The person search API endpoint requires Cloudflare Turnstile verification.
 * This function attempts the search via browser automation. If Turnstile blocks
 * the request, it returns an empty result with an explanation.
 */
export async function searchPerson(name: string, role?: string): Promise<PersonSearchResult[]> {
  const page = await browserManager.getPage();

  // Always navigate fresh — previous tool calls may have left overlays (spinner/Turnstile)
  await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });

  // Click "Search Other Businesses" to access the second search form
  // which may include person search
  const otherBusinessBtn = page.locator('button:has-text("Search Other Businesses")');
  if (await otherBusinessBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await otherBusinessBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // Look for a person/director search section
  const personSelectors = [
    'input[placeholder*="person" i]',
    'input[placeholder*="director" i]',
    'input[placeholder*="officer" i]',
    'input[id*="person" i]',
    'input[id*="director" i]',
  ];

  let personInput = null;
  for (const sel of personSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
      personInput = loc;
      break;
    }
  }

  if (!personInput) {
    // The person search may not be available on the free public site
    console.log('Person search input not found — feature may require CBRIS subscription or Turnstile verification');
    return [];
  }

  await personInput.clear();
  await personInput.fill(name);

  // If role filter is available, try to set it
  if (role && role !== 'all') {
    const roleSelect = page.locator('select[name*="role" i], select[id*="role" i]');
    if (await roleSelect.first().isVisible({ timeout: 1000 }).catch(() => false)) {
      await roleSelect.first().selectOption({ label: role }).catch(() => {});
    }
  }

  // Submit
  const searchBtn = page.locator('button[type="submit"], button:has-text("Search")');
  if (await searchBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchBtn.first().click();
  } else {
    await personInput.press('Enter');
  }

  await page.waitForTimeout(3000);
  await page.waitForLoadState(browserManager.waitUntil).catch(() => {});

  // Extract results using data-column attributes
  const results = await page.evaluate(() => {
    const extracted: Array<{
      personName: string;
      role: string;
      companyName: string;
      fileNumber: string;
      appointmentDate?: string;
    }> = [];

    const table = document.querySelector('lib-mns-universal-table table, table');
    if (!table) return extracted;

    const rows = table.querySelectorAll('tbody tr');
    for (const row of Array.from(rows)) {
      // Try data-column attributes first, then fall back to position
      const nameCell = row.querySelector('td[data-column*="Name" i]:first-of-type, td:nth-child(2)');
      const roleCell = row.querySelector('td[data-column*="Role" i], td[data-column*="Position" i], td:nth-child(3)');
      const companyCell = row.querySelector('td[data-column*="Company" i], td:nth-child(4)');
      const fileCell = row.querySelector('td[data-column*="File" i], td:nth-child(5)');
      const dateCell = row.querySelector('td[data-column*="Date" i], td:nth-child(6)');

      const personName = nameCell?.textContent?.trim() || '';
      if (personName && personName.length > 1) {
        extracted.push({
          personName,
          role: roleCell?.textContent?.trim() || '',
          companyName: companyCell?.textContent?.trim() || '',
          fileNumber: fileCell?.textContent?.trim() || '',
          appointmentDate: dateCell?.textContent?.trim() || undefined,
        });
      }
    }

    return extracted;
  });

  return results;
}
