import type { Page } from 'playwright-core';
import { browserManager } from '../browser/manager.js';
import type { CompanyDetails } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Get full details for a company by file number.
 *
 * First searches for the company, then clicks the "View" icon to navigate
 * to the details page. The details page is protected by Cloudflare Turnstile,
 * so if the token is not available, returns basic search info only.
 */
export async function getCompanyDetails(fileNumber: string): Promise<CompanyDetails> {
  const page = await browserManager.getPage();

  // Navigate to company details
  await navigateToCompanyDetails(page, fileNumber);

  // Wait for details page to load
  await page.waitForLoadState(browserManager.waitUntil).catch(() => {});
  await page.waitForTimeout(2000);

  // Extract all available details
  const details = await extractCompanyDetails(page, fileNumber);

  return details;
}

async function navigateToCompanyDetails(page: Page, fileNumber: string): Promise<void> {
  // Ensure we're on the search page
  if (!page.url().includes('onlinesearch.mns.mu')) {
    await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });
  }

  // Select File No. radio button (only click if not already selected)
  const fileNoRadio = page.locator('#fileNo');
  if (await fileNoRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
    const isChecked = await fileNoRadio.isChecked().catch(() => false);
    if (!isChecked) {
      await fileNoRadio.click();
      await page.waitForTimeout(300);
    }
  }

  // Fill in the file number and search
  const searchInput = page.locator('#company-partnership-text-field');
  if (!await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Angular SPA may be on a sub-route — navigate back to home
    await page.goto(CBRD_URL, { waitUntil: browserManager.waitUntil });
  }
  await searchInput.clear();
  await searchInput.fill(fileNumber);

  // Submit search
  const searchBtn = page.locator('button[type="submit"]');
  if (await searchBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchBtn.first().click();
  }

  // Wait for actual data rows (not the "No result" placeholder)
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('lib-mns-universal-table table tbody tr');
      if (rows.length === 0) return false;
      return rows[0].querySelector('td[data-column="Name"]') !== null;
    }, { timeout: 15_000 });
  } catch {}
  await page.waitForTimeout(1000);

  // Click the "View" icon (fa-icon with title="View") on the first result
  const viewIcon = page.locator('fa-icon[title="View"]').first();
  if (await viewIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
    await viewIcon.click();
    console.log('Clicked View icon for company details');
    // Wait for details page to load (Angular SPA navigation)
    await page.waitForTimeout(5000);
    await page.waitForLoadState(browserManager.waitUntil).catch(() => {});
  } else {
    console.log('View icon not found — details page may not be accessible');
  }
}

async function extractCompanyDetails(page: Page, fileNumber: string): Promise<CompanyDetails> {
  // Inject __name polyfill — esbuild/tsx adds __name() calls to function declarations
  // which don't exist in the browser context
  await page.evaluate(() => { (window as any).__name = (fn: any) => fn; });

  const details = await page.evaluate(function(fn) {
    var result = {
      companyName: '',
      fileNumber: fn,
      brn: undefined as string | undefined,
      status: undefined as string | undefined,
      type: undefined as string | undefined,
      registrationDate: undefined as string | undefined,
      registeredOffice: undefined as string | undefined,
      natureOfBusiness: undefined as string | undefined,
      directors: [] as Array<{ name: string; role: string; appointmentDate?: string; address?: string }>,
      shareholders: [] as Array<{ name: string; role: string; appointmentDate?: string; address?: string }>,
      secretaries: [] as Array<{ name: string; role: string; appointmentDate?: string; address?: string }>,
    };

    // Extract field by label matching
    function extractField(labels: string[]): string | undefined {
      var allLabels = document.querySelectorAll('label, dt, th, strong, b, h6, [class*="label"], [class*="key"]');
      for (var i = 0; i < allLabels.length; i++) {
        var el = allLabels[i];
        var text = (el.textContent || '').toLowerCase().trim();
        for (var j = 0; j < labels.length; j++) {
          if (text.includes(labels[j].toLowerCase())) {
            var value = (el.nextElementSibling as HTMLElement)?.textContent?.trim() ||
                        el.parentElement?.querySelector('dd, td, [class*="value"], span:not(:first-child)')?.textContent?.trim() ||
                        el.parentElement?.nextElementSibling?.textContent?.trim();
            if (value && value.length < 500) return value;
          }
        }
      }
      return undefined;
    }

    result.companyName = extractField(['company name', 'name of company', 'entity name']) || '';
    result.brn = extractField(['brn', 'business registration number']);
    result.status = extractField(['status', 'company status']);
    result.type = extractField(['type', 'company type', 'category']);
    result.registrationDate = extractField(['registration date', 'date of incorporation', 'incorporated']);
    result.registeredOffice = extractField(['registered office', 'address', 'office address']);
    result.natureOfBusiness = extractField(['nature of business', 'business activity', 'principal activity']);

    // Extract people from tables with section headers
    function extractPeople(sectionLabels: string[], role: string) {
      var people: Array<{ name: string; role: string; appointmentDate?: string; address?: string }> = [];
      var headers = document.querySelectorAll('h2, h3, h4, h5, [class*="section"], [class*="header"], [role="tab"]');
      for (var h = 0; h < headers.length; h++) {
        var headerText = (headers[h].textContent || '').toLowerCase();
        var matches = false;
        for (var s = 0; s < sectionLabels.length; s++) {
          if (headerText.includes(sectionLabels[s].toLowerCase())) { matches = true; break; }
        }
        if (!matches) continue;
        var nextEl = headers[h].nextElementSibling;
        while (nextEl && !['H2', 'H3', 'H4'].includes(nextEl.tagName)) {
          var rows = nextEl.querySelectorAll('tr, li, [class*="row"]');
          for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var nameCell = row.querySelector('td[data-column*="Name" i], td:first-child');
            var dateCell = row.querySelector('td[data-column*="Date" i], td:nth-child(2)');
            var addrCell = row.querySelector('td[data-column*="Address" i], td:nth-child(3)');
            var name = nameCell?.textContent?.trim();
            if (name && name.length > 1) {
              people.push({
                name: name,
                role: role,
                appointmentDate: dateCell?.textContent?.trim() || undefined,
                address: addrCell?.textContent?.trim() || undefined,
              });
            }
          }
          nextEl = nextEl.nextElementSibling;
        }
      }
      return people;
    }

    result.directors = extractPeople(['director'], 'Director');
    result.shareholders = extractPeople(['shareholder', 'member'], 'Shareholder');
    result.secretaries = extractPeople(['secretary'], 'Secretary');

    // Fallback: if still on search results page, extract basic info from the table
    if (!result.companyName) {
      var table = document.querySelector('lib-mns-universal-table table');
      if (table) {
        var firstRow = table.querySelector('tbody tr');
        if (firstRow) {
          var nameCell = firstRow.querySelector('td[data-column="Name"]');
          var statusCell = firstRow.querySelector('td[data-column="Status"]');
          var categoryCell = firstRow.querySelector('td[data-column="Category"]');
          var natureCell = firstRow.querySelector('td[data-column="Nature"]');
          var dateCell = firstRow.querySelector('td[data-column="Incorporation/ Registration Date"]');

          result.companyName = nameCell?.textContent?.trim() || '';
          result.status = statusCell?.textContent?.trim() || undefined;
          result.type = ((categoryCell?.textContent?.trim() || '') + ' ' + (natureCell?.textContent?.trim() || '')).trim() || undefined;
          result.registrationDate = dateCell?.textContent?.trim() || undefined;
        }
      }
    }

    // Last resort: page title
    if (!result.companyName) {
      result.companyName = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() || '';
    }

    return result;
  }, fileNumber);

  return details as CompanyDetails;
}
