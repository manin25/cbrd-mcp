import type { Page } from 'patchright-core';
import { browserManager } from '../browser/manager.js';
import { lookupCompany } from './lookup.js';
import type { CompanyDetails } from '../types.js';

/**
 * Get full details for a company by file number.
 *
 * Workflow:
 * 1. Look up the company via file number to populate search results
 * 2. Click the View icon — this triggers a Turnstile verification overlay
 * 3. Wait for Turnstile to auto-solve (patchright stealth handles this)
 * 4. Extract directors, shareholders, secretaries from the details page
 */
export async function getCompanyDetails(fileNumber: string): Promise<CompanyDetails> {
  // Step 1: Look up the company to populate search results on the page
  const searchResults = await lookupCompany(fileNumber, undefined);

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

  // Step 2: Click View and extract details
  const page = await browserManager.getPage();
  const extraDetails = await tryClickViewAndExtract(page, fileNumber);

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
    // Find the View icon in search results
    const viewIcon = page.locator('fa-icon[title="View"]').first();
    if (!await viewIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[details] View icon not found on search results page');
      return null;
    }

    // Use Playwright's real .click() to trigger Angular's zone.js handler.
    // This WILL cause the Turnstile overlay (cbris-turnstile) to appear and
    // intercept pointer events — that's expected. The click will "fail" with
    // a timeout, but Angular has already started the navigation + Turnstile flow.
    console.log('[details] Clicking View icon (real click, expecting Turnstile intercept)...');
    await viewIcon.click({ timeout: 5000 }).catch((err: any) => {
      console.log('[details] Click intercepted (expected):', String(err).substring(0, 200));
    });

    // Now wait for the Turnstile overlay to appear and then auto-resolve
    console.log('[details] Checking for Turnstile overlay...');
    await page.waitForTimeout(500);

    const turnstileSelector = 'cbris-turnstile';
    const hasTurnstile = await page.locator(turnstileSelector).first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log('[details] Turnstile overlay visible:', hasTurnstile);

    if (hasTurnstile) {
      // Wait for Turnstile to auto-solve and disappear (patchright stealth should handle this)
      console.log('[details] Waiting for Turnstile to auto-solve (up to 30s)...');
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector('cbris-turnstile');
          if (!el) return true;
          // Check if it's been removed or hidden
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
          // Check if it no longer has the overlay div
          const overlay = el.querySelector('.d-flex.justify-content-center.align-items-center');
          if (!overlay) return true;
          const overlayStyle = window.getComputedStyle(overlay);
          return overlayStyle.display === 'none' || overlayStyle.visibility === 'hidden';
        }, { timeout: 30_000 });
        console.log('[details] Turnstile resolved!');
      } catch {
        console.log('[details] Turnstile did NOT resolve within 30s');
        // Log Turnstile state for debugging
        const turnstileState = await page.evaluate(() => {
          const el = document.querySelector('cbris-turnstile');
          if (!el) return 'not found';
          return {
            outerHTML: el.outerHTML.substring(0, 500),
            childCount: el.children.length,
            iframeCount: el.querySelectorAll('iframe').length,
            iframeSrc: Array.from(el.querySelectorAll('iframe')).map(f => (f as HTMLIFrameElement).src).join(', '),
          };
        });
        console.log('[details] Turnstile state after timeout:', JSON.stringify(turnstileState));
        return null;
      }
    }

    // Wait for details page content to load
    await page.waitForTimeout(2000);
    await page.waitForLoadState(browserManager.waitUntil).catch(() => {});

    // Log final page state
    const pageState = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .map(h => `${h.tagName}: "${(h.textContent || '').trim().substring(0, 80)}"`)
        .slice(0, 15),
      bodyLength: document.body.innerHTML.length,
    }));
    console.log('[details] Page state after Turnstile:', JSON.stringify(pageState));

    // Check if we're still on the search page
    const isStillSearchPage = await page.locator('h6:has-text("Make a Search")').isVisible({ timeout: 1000 }).catch(() => false);
    if (isStillSearchPage) {
      console.log('[details] Still on search page after Turnstile — navigation failed');
      return null;
    }

    // We navigated to the details page! Extract everything.
    return await extractDetailsFromPage(page, fileNumber);
  } catch (err) {
    console.log('[details] Failed to extract details:', err);
    return null;
  }
}

async function extractDetailsFromPage(
  page: Page,
  fileNumber: string,
): Promise<CompanyDetails | null> {
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

  if (details.companyName && !details.companyName.toLowerCase().includes('make a search')) {
    return details as CompanyDetails;
  }

  return null;
}
