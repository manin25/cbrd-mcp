import type { Page } from 'playwright-core';
import { browserManager } from '../browser/manager.js';
import { lookupCompany } from './lookup.js';
import type { CompanyDetails } from '../types.js';

/**
 * Get full details for a company by file number.
 *
 * Workflow: first looks up the company to get basic info from search results,
 * then attempts to click the "View" icon from those results to navigate to
 * the details page. If the details page is blocked by Cloudflare Turnstile,
 * falls back to the basic search result info.
 */
export async function getCompanyDetails(fileNumber: string): Promise<CompanyDetails> {
  // Step 1: Look up the company to populate search results on the page
  const searchResults = await lookupCompany(fileNumber, undefined);

  // Build base details from search results
  const match = searchResults.find(r => r.fileNumber === fileNumber) || searchResults[0];
  const baseDetails: CompanyDetails = {
    companyName: match?.companyName || '',
    fileNumber,
    status: match?.status,
    type: match?.type,
    directors: [],
    shareholders: [],
    secretaries: [],
  };

  if (!match) {
    return baseDetails;
  }

  // Step 2: Try clicking View icon from the search results already on page
  const page = await browserManager.getPage();
  const extraDetails = await tryClickViewAndExtract(page, fileNumber);

  // Merge any extra details from the details page into base
  if (extraDetails) {
    return {
      ...baseDetails,
      companyName: extraDetails.companyName || baseDetails.companyName,
      brn: extraDetails.brn || baseDetails.brn,
      registrationDate: extraDetails.registrationDate || baseDetails.registrationDate,
      registeredOffice: extraDetails.registeredOffice,
      natureOfBusiness: extraDetails.natureOfBusiness,
      directors: extraDetails.directors.length > 0 ? extraDetails.directors : baseDetails.directors,
      shareholders: extraDetails.shareholders.length > 0 ? extraDetails.shareholders : baseDetails.shareholders,
      secretaries: extraDetails.secretaries.length > 0 ? extraDetails.secretaries : baseDetails.secretaries,
    };
  }

  return baseDetails;
}

async function tryClickViewAndExtract(
  page: Page,
  fileNumber: string,
): Promise<CompanyDetails | null> {
  try {
    // The search results should still be on the page from lookupCompany
    const viewIcon = page.locator('fa-icon[title="View"]').first();
    if (!await viewIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('View icon not found on search results page');
      return null;
    }

    await viewIcon.click();
    console.log('Clicked View icon for company details');

    // Wait for details page to load (Angular SPA navigation)
    await page.waitForTimeout(5000);
    await page.waitForLoadState(browserManager.waitUntil).catch(() => {});

    // Inject __name polyfill for esbuild/tsx compatibility
    await page.evaluate(() => { (window as any).__name = (fn: any) => fn; });

    // Extract details from the details page
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

      return result;
    }, fileNumber);

    // Only return if we actually got meaningful data (not a Turnstile challenge page)
    if (details.companyName && !details.companyName.toLowerCase().includes('make a search')) {
      return details as CompanyDetails;
    }

    console.log('Details page appears to be blocked by Turnstile — using search results fallback');
    return null;
  } catch (err) {
    console.log('Failed to extract details page:', err);
    return null;
  }
}
