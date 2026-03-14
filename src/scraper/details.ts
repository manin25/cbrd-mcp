import type { Page } from 'playwright-core';
import { browserManager } from '../browser/manager.js';
import type { CompanyDetails, PersonRole } from '../types.js';

/**
 * Get full details for a company by file number.
 */
export async function getCompanyDetails(fileNumber: string): Promise<CompanyDetails> {
  const page = await browserManager.getPage();

  // Navigate to company details — try clicking from search results or direct URL
  await navigateToCompanyDetails(page, fileNumber);

  // Wait for details to load
  await page.waitForLoadState(browserManager.waitUntil);
  await page.waitForTimeout(2000);

  // Extract all available details
  const details = await extractCompanyDetails(page, fileNumber);

  return details;
}

async function navigateToCompanyDetails(page: Page, fileNumber: string): Promise<void> {
  // Strategy 1: Look for a link/row with the file number
  const fileLink = page.locator(`a:has-text("${fileNumber}"), td:has-text("${fileNumber}"), [class*="file"]:has-text("${fileNumber}")`);
  if (await fileLink.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await fileLink.first().click();
    await page.waitForLoadState(browserManager.waitUntil);
    return;
  }

  // Strategy 2: Search for the company by file number first
  const { searchCompany } = await import('./search.js');
  await searchCompany(fileNumber, 5);

  // Then try clicking the first result
  const resultLink = page.locator('table tbody tr a, .mat-row a, tr[class*="row"] a, table tbody tr td').first();
  if (await resultLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await resultLink.click();
    await page.waitForLoadState(browserManager.waitUntil);
  }
}

async function extractCompanyDetails(page: Page, fileNumber: string): Promise<CompanyDetails> {
  const details = await page.evaluate((fn) => {
    const result: {
      companyName: string;
      fileNumber: string;
      brn?: string;
      status?: string;
      type?: string;
      registrationDate?: string;
      registeredOffice?: string;
      natureOfBusiness?: string;
      directors: Array<{ name: string; role: string; appointmentDate?: string; address?: string }>;
      shareholders: Array<{ name: string; role: string; appointmentDate?: string; address?: string }>;
      secretaries: Array<{ name: string; role: string; appointmentDate?: string; address?: string }>;
    } = {
      companyName: '',
      fileNumber: fn,
      directors: [],
      shareholders: [],
      secretaries: [],
    };

    // Extract key-value pairs from the page
    // Look for label-value patterns common in detail pages
    const extractField = (labels: string[]): string | undefined => {
      for (const label of labels) {
        // Try label elements
        const labelEls = document.querySelectorAll('label, dt, th, strong, b, [class*="label"], [class*="key"]');
        for (const el of Array.from(labelEls)) {
          if (el.textContent?.toLowerCase().includes(label.toLowerCase())) {
            // The value is usually the next sibling or the parent's next element
            const value = el.nextElementSibling?.textContent?.trim() ||
                          el.parentElement?.querySelector('dd, td, [class*="value"], span')?.textContent?.trim() ||
                          el.parentElement?.nextElementSibling?.textContent?.trim();
            if (value) return value;
          }
        }
      }
      return undefined;
    };

    result.companyName = extractField(['company name', 'name of company', 'entity name']) || '';
    result.brn = extractField(['brn', 'business registration', 'registration number']);
    result.status = extractField(['status', 'company status']);
    result.type = extractField(['type', 'company type', 'entity type']);
    result.registrationDate = extractField(['registration date', 'date of incorporation', 'incorporated']);
    result.registeredOffice = extractField(['registered office', 'address', 'office address']);
    result.natureOfBusiness = extractField(['nature of business', 'business activity', 'principal activity']);

    // Extract people (directors, shareholders, secretaries)
    const extractPeople = (sectionLabels: string[], role: string) => {
      const people: Array<{ name: string; role: string; appointmentDate?: string; address?: string }> = [];

      // Find section headers
      const headers = document.querySelectorAll('h2, h3, h4, h5, [class*="section"], [class*="header"], [role="tab"]');
      for (const header of Array.from(headers)) {
        const headerText = header.textContent?.toLowerCase() || '';
        if (sectionLabels.some(l => headerText.includes(l.toLowerCase()))) {
          // Find the table/list following this header
          let nextEl = header.nextElementSibling;
          while (nextEl && !['H2', 'H3', 'H4'].includes(nextEl.tagName)) {
            const rows = nextEl.querySelectorAll('tr, li, [class*="row"]');
            for (const row of Array.from(rows)) {
              const cells = row.querySelectorAll('td, span, [class*="cell"]');
              const name = cells[0]?.textContent?.trim();
              if (name && name.length > 1) {
                people.push({
                  name,
                  role,
                  appointmentDate: cells[1]?.textContent?.trim() || undefined,
                  address: cells[2]?.textContent?.trim() || undefined,
                });
              }
            }
            nextEl = nextEl.nextElementSibling;
          }
        }
      }

      // Fallback: look for tables with the role in column headers
      if (people.length === 0) {
        const tables = document.querySelectorAll('table');
        for (const table of Array.from(tables)) {
          const headerRow = table.querySelector('thead tr, tr:first-child');
          const headerText = headerRow?.textContent?.toLowerCase() || '';
          if (sectionLabels.some(l => headerText.includes(l.toLowerCase()))) {
            const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
            for (const row of Array.from(rows)) {
              const cells = row.querySelectorAll('td');
              const name = cells[0]?.textContent?.trim();
              if (name) {
                people.push({
                  name,
                  role,
                  appointmentDate: cells[1]?.textContent?.trim() || undefined,
                  address: cells[2]?.textContent?.trim() || undefined,
                });
              }
            }
          }
        }
      }

      return people;
    };

    result.directors = extractPeople(['director'], 'Director');
    result.shareholders = extractPeople(['shareholder', 'member'], 'Shareholder');
    result.secretaries = extractPeople(['secretary'], 'Secretary');

    // If company name is still empty, try the page title or first heading
    if (!result.companyName) {
      result.companyName = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || '';
    }

    return result;
  }, fileNumber);

  return details as CompanyDetails;
}
