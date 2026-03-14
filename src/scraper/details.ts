import type { Page } from 'patchright-core';
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

    // Inspect the View icon's HTML and parent structure
    const viewHtml = await viewIcon.evaluate(el => {
      const parent = el.closest('a, button, [routerlink], [ng-click], [click]');
      return {
        tagName: el.tagName,
        outerHTML: el.outerHTML.substring(0, 300),
        parentTag: parent?.tagName || 'none',
        parentHTML: parent?.outerHTML?.substring(0, 300) || 'none',
        parentHref: (parent as HTMLAnchorElement)?.href || 'none',
        parentTarget: (parent as HTMLAnchorElement)?.target || 'none',
        // Walk up to find any clickable ancestor
        ancestors: (() => {
          const anc: string[] = [];
          let p: Element | null = el;
          for (let i = 0; i < 5 && p; i++) {
            anc.push(`${p.tagName}${p.className ? '.' + p.className.replace(/\s+/g, '.') : ''}`);
            p = p.parentElement;
          }
          return anc;
        })(),
      };
    });
    console.log('[details] View icon structure:', JSON.stringify(viewHtml, null, 2));

    // Listen for popup/new tab
    const popupPromise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);

    // Try clicking the parent link/button if the icon itself isn't the click target
    const clickTarget = viewHtml.parentTag !== 'none'
      ? viewIcon.locator('xpath=ancestor::a | ancestor::button').first()
      : viewIcon;

    const hasParentClickable = await clickTarget.count() > 0;
    if (hasParentClickable && viewHtml.parentTag !== 'none') {
      console.log('[details] Clicking parent clickable element instead of icon');
      await clickTarget.click();
    } else {
      await viewIcon.click();
    }
    console.log('[details] Click performed');

    // Check for popup
    const popup = await popupPromise;
    if (popup) {
      console.log('[details] NEW TAB/POPUP detected! URL:', popup.url());
      await popup.waitForLoadState('networkidle').catch(() => {});
      console.log('[details] Popup loaded, URL:', popup.url());
      // Switch to popup page for extraction
      const popupDebug = await popup.evaluate(() => ({
        url: location.href,
        title: document.title,
        bodyLength: document.body.innerHTML.length,
        headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => h.textContent?.trim()).slice(0, 10),
      }));
      console.log('[details] Popup structure:', JSON.stringify(popupDebug));
      // Use popup page instead for extraction below
      // page = popup; // We'll handle this after
    }

    // Wait for details page to load (Angular SPA navigation)
    await page.waitForTimeout(3000);
    console.log('[details] URL after View click:', page.url());

    // Check if Turnstile overlay is present and wait for it to resolve
    const turnstile = page.locator('cbris-turnstile, [class*="turnstile"]');
    const hasTurnstile = await turnstile.first().isVisible({ timeout: 2000 }).catch(() => false);
    console.log('[details] Turnstile visible:', hasTurnstile);

    if (hasTurnstile) {
      // Wait for Turnstile to auto-solve (up to 15s)
      console.log('[details] Waiting for Turnstile to resolve...');
      try {
        await page.waitForFunction(() => {
          const t = document.querySelector('cbris-turnstile, [class*="turnstile"]');
          if (!t) return true;
          // Check if it's hidden or removed
          const style = window.getComputedStyle(t);
          return style.display === 'none' || style.visibility === 'hidden';
        }, { timeout: 15_000 });
        console.log('[details] Turnstile resolved!');
        await page.waitForTimeout(2000);
      } catch {
        console.log('[details] Turnstile did not resolve within 15s');
      }
    }

    await page.waitForLoadState(browserManager.waitUntil).catch(() => {});

    // Dump page structure for debugging
    const pageDebug = await page.evaluate(() => {
      const body = document.body;
      // Get all visible text sections
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, .card-header, [class*="title"], [class*="header"]'))
        .map(h => `${h.tagName}${h.className ? '.' + h.className.split(' ').join('.') : ''}: "${(h.textContent || '').trim().substring(0, 100)}"`);

      // Get all label-value pairs
      const labels = Array.from(document.querySelectorAll('label, dt, th, strong, b, .form-label, [class*="label"]'))
        .slice(0, 30)
        .map(l => {
          const text = (l.textContent || '').trim();
          const sibling = (l.nextElementSibling as HTMLElement)?.textContent?.trim() || '';
          return `"${text.substring(0, 50)}" → "${sibling.substring(0, 80)}"`;
        });

      // Get all tables
      const tables = Array.from(document.querySelectorAll('table'))
        .map(t => {
          const rows = t.querySelectorAll('tr');
          return `Table(${rows.length} rows): ${Array.from(t.querySelectorAll('th')).map(th => th.textContent?.trim()).join(', ')}`;
        });

      // Check for tabs/accordion
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .nav-link, .mat-tab-label'))
        .map(t => (t.textContent || '').trim());

      return { url: location.href, headings, labels: labels.slice(0, 20), tables, tabs, bodyLength: body.innerHTML.length };
    });
    console.log('[details] Page structure:', JSON.stringify(pageDebug, null, 2));

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
