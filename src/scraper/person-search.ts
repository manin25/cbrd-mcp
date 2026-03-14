import { browserManager } from '../browser/manager.js';
import type { PersonSearchResult } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Search for a person's name across CBRD company records.
 */
export async function searchPerson(name: string, role?: string): Promise<PersonSearchResult[]> {
  const page = await browserManager.getPage();

  if (!page.url().includes('onlinesearch.mns.mu')) {
    await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });
  }

  await page.waitForLoadState(browserManager.waitUntil);

  // Try to find a person search tab/section
  const personTab = page.locator('[data-tab*="person"], [class*="person"], a:has-text("Person"), button:has-text("Person"), label:has-text("Person"), [role="tab"]:has-text("Person"), option:has-text("Person")');
  if (await personTab.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await personTab.first().click();
    await page.waitForTimeout(1000);
  }

  // Find the person name input
  const nameInput = page.locator('input[name*="person" i], input[name*="name" i], input[placeholder*="person" i], input[placeholder*="name" i], input[type="text"]').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.clear();
    await nameInput.fill(name);
  } else {
    throw new Error('Could not find person search input on CBRD page.');
  }

  // If role filter is available, try to set it
  if (role && role !== 'all') {
    const roleSelect = page.locator('select[name*="role" i], [class*="role"]');
    if (await roleSelect.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await roleSelect.first().selectOption({ label: role });
    }
  }

  // Submit search
  const searchBtn = page.locator('button[type="submit"], button:has-text("Search"), button:has-text("Find")');
  if (await searchBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchBtn.first().click();
  } else {
    await page.keyboard.press('Enter');
  }

  // Wait for results
  await page.waitForLoadState(browserManager.waitUntil);
  await page.waitForTimeout(2000);

  // Extract results
  const results = await page.evaluate(() => {
    const extracted: Array<{
      personName: string;
      role: string;
      companyName: string;
      fileNumber: string;
      appointmentDate?: string;
    }> = [];

    const rows = document.querySelectorAll('table tbody tr, .mat-row, tr[class*="row"]');
    for (const row of Array.from(rows)) {
      const cells = row.querySelectorAll('td, .mat-cell');
      if (cells.length >= 3) {
        extracted.push({
          personName: cells[0]?.textContent?.trim() || '',
          role: cells[1]?.textContent?.trim() || '',
          companyName: cells[2]?.textContent?.trim() || '',
          fileNumber: cells[3]?.textContent?.trim() || '',
          appointmentDate: cells[4]?.textContent?.trim() || undefined,
        });
      }
    }

    return extracted;
  });

  return results.filter(r => r.personName.length > 0);
}
