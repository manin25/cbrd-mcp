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
 * 2. Use BrowserQL (browserless.io) to navigate, click View, solve Turnstile CAPTCHA
 * 3. Reconnect with Playwright to extract directors, shareholders, secretaries
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

  // Step 2: Try getting full details via BrowserQL (CAPTCHA-solving cloud browser)
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
 * Use BrowserQL to navigate the CBRD site, click View, solve Turnstile,
 * then reconnect with Playwright to extract the details page content.
 */
async function getDetailsViaBrowserless(fileNumber: string): Promise<CompanyDetails | null> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    console.log('[details] No BROWSERLESS_TOKEN — skipping cloud browser details');
    return null;
  }

  try {
    const timeout = 60000;
    const queryParams = new URLSearchParams({ token, timeout: String(timeout) });
    const endpoint = `https://production-lon.browserless.io/chromium/bql?${queryParams}`;

    // BQL mutation: navigate to CBRD, search by file number, click View, solve CAPTCHA
    const bqlQuery = `mutation SearchAndView {
      goto(url: "${CBRD_URL}", waitUntil: networkIdle) { status }
      fileNoRadio: click(selector: "#fileNo") { time }
      typeFileNo: type(selector: "input[formcontrolname='searchText']", text: "${fileNumber}") { time }
      search: click(selector: "button[type='submit']") { time }
      waitView: waitForSelector(selector: "fa-icon[title=\\"View\\"]", timeout: 15000) { time }
      viewClick: click(selector: "fa-icon[title=\\"View\\"]") { time }
      solveCaptcha: solve { found solved time }
      reconnect(timeout: 30000) { browserWSEndpoint }
    }`;

    console.log('[details] Sending BQL request to browserless.io...');
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: bqlQuery }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.log(`[details] BQL HTTP ${resp.status}: ${text.substring(0, 200)}`);
      return null;
    }

    const json = await resp.json();
    console.log('[details] BQL response:', JSON.stringify({
      status: json.data?.goto?.status,
      captchaFound: json.data?.solveCaptcha?.found,
      captchaSolved: json.data?.solveCaptcha?.solved,
      captchaTime: json.data?.solveCaptcha?.time,
      hasEndpoint: !!json.data?.reconnect?.browserWSEndpoint,
      errors: json.errors?.map((e: any) => e.message),
    }));

    if (json.errors?.length) {
      console.log('[details] BQL errors:', JSON.stringify(json.errors));
      return null;
    }

    const wsEndpoint = json.data?.reconnect?.browserWSEndpoint;
    if (!wsEndpoint) {
      console.log('[details] No browserWSEndpoint returned from BQL');
      return null;
    }

    // Reconnect with Playwright to extract details from the loaded page
    // Token must be appended to the reconnect URL
    const reconnectUrl = `${wsEndpoint}?token=${token}`;
    console.log('[details] Reconnecting with Playwright...');
    const browser = await chromium.connectOverCDP(reconnectUrl);
    const context = browser.contexts()[0];
    const page = context?.pages()[0];

    if (!page) {
      console.log('[details] No page found after reconnect');
      await browser.close();
      return null;
    }

    // Wait for the details page content to settle
    await page.waitForLoadState('networkidle').catch(() => {});

    const details = await extractDetailsFromPage(page, fileNumber);
    await browser.close();
    return details;
  } catch (err) {
    console.log('[details] BrowserQL error:', err);
    return null;
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
