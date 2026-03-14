import type { Page } from 'patchright-core';
import { chromium } from 'patchright-core';
import { lookupCompany } from './lookup.js';
import type { CompanyDetails } from '../types.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

/**
 * Get full details for a company by file number.
 *
 * Workflow:
 * 1. Look up the company via local browser to get basic info (name, status, type)
 * 2. Connect Playwright to Browserless (solveCaptchas=true) to navigate, click View
 * 3. Browserless auto-solves Turnstile CAPTCHA, then extract details
 */
export async function getCompanyDetails(fileNumber: string): Promise<CompanyDetails> {
  // Step 1: Look up the company for base details
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

  if (!match) return baseDetails;

  // Step 2: Try getting full details via Browserless (CAPTCHA-solving cloud browser)
  const extraDetails = await getDetailsViaBrowserless(fileNumber);

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

/**
 * Connect Playwright to Browserless with solveCaptchas=true.
 * Browserless auto-solves Turnstile when it appears after clicking View.
 * Uses Playwright's .fill() which properly triggers Angular change detection.
 */
async function getDetailsViaBrowserless(fileNumber: string): Promise<CompanyDetails | null> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    console.log('[details] No BROWSERLESS_TOKEN — skipping');
    return null;
  }

  let browser;
  try {
    // Connect Playwright directly to Browserless with auto CAPTCHA solving
    const wsUrl = `wss://production-lon.browserless.io/chromium?token=${token}&timeout=60000&solveCaptchas=true`;
    console.log('[details] Connecting to Browserless...');
    browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();

    // Set up CDP session to listen for CAPTCHA events
    const cdp = await context.newCDPSession(page);
    let captchaResolved = false;
    let captchaResolve: (() => void) | null = null;
    const captchaPromise = new Promise<void>((resolve) => {
      captchaResolve = resolve;
      // Auto-resolve after 30s if no captcha appears
      setTimeout(() => { if (!captchaResolved) resolve(); }, 30000);
    });
    (cdp as any).on('Browserless.captchaAutoSolved', () => {
      console.log('[details] CAPTCHA auto-solved');
      captchaResolved = true;
      captchaResolve?.();
    });

    // Navigate to CBRD
    await page.goto(CBRD_URL, { waitUntil: 'networkidle' });

    // Wait for Angular to bootstrap
    await page.waitForSelector('#company-partnership-text-field', { timeout: 10000 });

    // Switch to File No. search mode
    await page.click('#fileNo');
    await page.waitForTimeout(300);

    // Fill search — Playwright .fill() triggers Angular's input/change events
    await page.fill('#company-partnership-text-field', fileNumber);

    // Submit search
    await page.click('button[type="submit"]');

    // Wait for actual data rows (not the "No result" placeholder)
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('lib-mns-universal-table table tbody tr');
      if (rows.length === 0) return false;
      return rows[0].querySelector('td[data-column="Name"]') !== null;
    }, { timeout: 15000 });

    // Click the View icon — try the parent action-btn div first (Angular handler target)
    const viewIcon = page.locator('fa-icon[title="View"]').first();
    await viewIcon.waitFor({ timeout: 5000 });
    const actionBtn = viewIcon.locator('xpath=ancestor::div[contains(@class,"action-btn")]').first();
    if (await actionBtn.count() > 0) {
      await actionBtn.click();
    } else {
      await viewIcon.click();
    }

    // Wait for CAPTCHA to be solved (or 30s timeout if none appears)
    console.log('[details] Waiting for CAPTCHA resolution...');
    await captchaPromise;

    // Wait for details page to load after CAPTCHA
    await page.waitForLoadState('networkidle').catch(() => {});

    // Extract details
    const details = await extractDetailsFromPage(page, fileNumber);
    return details;
  } catch (err) {
    console.log('[details] Browserless error:', err);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function extractDetailsFromPage(
  page: Page,
  fileNumber: string,
): Promise<CompanyDetails | null> {
  // Log what page we're on for debugging
  const pageInfo = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .map(h => (h.textContent || '').trim().substring(0, 60))
      .slice(0, 10),
  }));
  console.log('[details] Extracting from page:', JSON.stringify(pageInfo));

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

  console.log('[details] Page appears to be search page, not details');
  return null;
}
