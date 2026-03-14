import type { Page } from 'patchright-core';
import { chromium } from 'patchright-core';
import { lookupCompany } from './lookup.js';
import { dismissCookieConsent } from '../browser/cookies.js';
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
      ...extraDetails,
      companyName: extraDetails.companyName || baseDetails.companyName,
      status: extraDetails.status || baseDetails.status,
      type: extraDetails.type || baseDetails.type,
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

    // Dismiss cookie consent banner (blocks clicks if not dismissed)
    await dismissCookieConsent(page);

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

    // After CAPTCHA is solved, the original View click was consumed by the
    // Turnstile overlay — Angular never received the (click) event.
    // Check if the dialog opened; if not, re-click View.
    await page.waitForTimeout(1000);

    let dialogOpen = await page.locator('mat-dialog-container').isVisible({ timeout: 2000 }).catch(() => false);

    if (!dialogOpen) {
      console.log('[details] Dialog not open after CAPTCHA — re-clicking View');
      const viewIconRetry = page.locator('fa-icon[title="View"]').first();
      if (await viewIconRetry.isVisible({ timeout: 3000 }).catch(() => false)) {
        const actionBtnRetry = viewIconRetry.locator('xpath=ancestor::div[contains(@class,"action-btn")]').first();
        if (await actionBtnRetry.count() > 0) {
          await actionBtnRetry.click();
        } else {
          await viewIconRetry.click();
        }
      }
    }

    // Wait for the Material Dialog to appear (cbris-details-dialog)
    try {
      await page.waitForSelector('mat-dialog-container', { timeout: 15000 });
      // Wait for content inside — label.value elements appear when data loads
      await page.waitForSelector('mat-dialog-container label.value', { timeout: 10000 });
      console.log('[details] Details dialog loaded');
    } catch {
      console.log('[details] Timed out waiting for details dialog');
    }

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

/**
 * Extract details from the Material Dialog that opens after clicking View.
 * The dialog uses:
 * - label.label / label.value pairs for company info
 * - mat-expansion-panel sections for each data category
 * - lib-mns-universal-table with data-column attributes for tables
 */
async function extractDetailsFromPage(
  page: Page,
  fileNumber: string,
): Promise<CompanyDetails | null> {
  // Log dialog state for debugging
  const dialogInfo = await page.evaluate(() => {
    const dialog = document.querySelector('mat-dialog-container');
    const title = document.querySelector('h2.mat-dialog-title');
    const panels = Array.from(document.querySelectorAll('mat-panel-title'))
      .map(p => (p.textContent || '').trim());
    return {
      hasDialog: !!dialog,
      title: title?.textContent?.trim() || '',
      panels,
    };
  });
  console.log('[details] Dialog state:', JSON.stringify(dialogInfo));

  if (!dialogInfo.hasDialog) {
    console.log('[details] No dialog found on page');
    return null;
  }

  const details = await page.evaluate(function(fn) {
    var dialog = document.querySelector('mat-dialog-container');
    if (!dialog) return null;

    // Helper: get label.value text for a given label.label text
    function getField(labelText: string): string | undefined {
      var labels = dialog!.querySelectorAll('label.label');
      for (var i = 0; i < labels.length; i++) {
        var text = (labels[i].textContent || '').replace(':', '').trim().toLowerCase();
        if (text === labelText.toLowerCase()) {
          var valueLabel = labels[i].nextElementSibling;
          if (valueLabel && valueLabel.classList.contains('value')) {
            var val = (valueLabel.textContent || '').trim();
            if (val) return val;
          }
        }
      }
      return undefined;
    }

    // Helper: find expansion panel by title, return its table rows
    function getPanelTableRows(panelTitle: string): Element[] {
      var panels = dialog!.querySelectorAll('mat-expansion-panel');
      for (var i = 0; i < panels.length; i++) {
        var title = panels[i].querySelector('mat-panel-title');
        if (title && (title.textContent || '').trim().toUpperCase().includes(panelTitle.toUpperCase())) {
          return Array.from(panels[i].querySelectorAll('tbody tr'));
        }
      }
      return [];
    }

    // Helper: get cell text by data-column attribute
    function cellText(row: Element, column: string): string | undefined {
      var cell = row.querySelector('td[data-column="' + column + '"]');
      var text = cell?.textContent?.trim();
      return text || undefined;
    }

    // --- COMPANY DETAILS ---
    var companyName = getField('Name') || '';
    var result: any = {
      companyName: companyName,
      fileNumber: getField('File No.') || fn,
      status: getField('Status'),
      type: getField('Type'),
      nature: getField('Nature'),
      category: getField('Category'),
      subCategory: getField('Sub-category'),
      registrationDate: getField('Date Incorporated/Registered'),
      registeredOffice: getField('Registered Office Address'),
      effectiveDateRegisteredOffice: getField('Effective Date for Registered Office Address'),
      directors: [] as any[],
      shareholders: [] as any[],
      secretaries: [] as any[],
    };

    // --- BUSINESS DETAILS ---
    var bizRows = getPanelTableRows('BUSINESS DETAILS');
    var businessDetails: any[] = [];
    for (var b = 0; b < bizRows.length; b++) {
      var brn = cellText(bizRows[b], 'Business Registration No.');
      var bizName = cellText(bizRows[b], 'Business Name');
      if (brn || bizName) {
        businessDetails.push({
          brn: brn,
          businessName: bizName,
          natureOfBusiness: cellText(bizRows[b], 'Nature of Business'),
          businessAddress: cellText(bizRows[b], 'Business Address'),
        });
      }
    }
    result.businessDetails = businessDetails;
    // Set top-level BRN and natureOfBusiness from first business detail
    if (businessDetails.length > 0) {
      result.brn = businessDetails[0].brn;
      result.natureOfBusiness = businessDetails[0].natureOfBusiness;
    }

    // --- STATED CAPITAL ---
    var capRows = getPanelTableRows('PARTICULARS OF STATED CAPITAL');
    var statedCapital: any[] = [];
    for (var c = 0; c < capRows.length; c++) {
      statedCapital.push({
        typeOfShares: cellText(capRows[c], 'Type of Shares'),
        numberOfShares: cellText(capRows[c], 'No. of Shares'),
        currency: cellText(capRows[c], 'Currency'),
        statedCapital: cellText(capRows[c], 'Stated Capital'),
        amountUnpaid: cellText(capRows[c], 'Amount Unpaid'),
        parValue: cellText(capRows[c], 'Par Value'),
      });
    }
    result.statedCapital = statedCapital;

    // --- OFFICE BEARERS (directors + secretaries in one table) ---
    var bearerRows = getPanelTableRows('OFFICE BEARERS');
    for (var o = 0; o < bearerRows.length; o++) {
      var position = (cellText(bearerRows[o], 'Position') || '').toUpperCase();
      var name = cellText(bearerRows[o], 'Name');
      if (!name) continue;
      var person = {
        name: name,
        role: position,
        appointmentDate: cellText(bearerRows[o], 'Appointed Date'),
        address: cellText(bearerRows[o], 'Address'),
      };
      if (position.includes('DIRECTOR')) {
        result.directors.push(person);
      } else if (position.includes('SECRETARY')) {
        result.secretaries.push(person);
      } else {
        // Other office bearers go to directors by default
        result.directors.push(person);
      }
    }

    // --- SHAREHOLDERS ---
    var shRows = getPanelTableRows('SHAREHOLDERS');
    for (var s = 0; s < shRows.length; s++) {
      var shName = cellText(shRows[s], 'Name');
      if (!shName) continue;
      result.shareholders.push({
        name: shName,
        numberOfShares: cellText(shRows[s], 'No. of Shares'),
        typeOfShares: cellText(shRows[s], 'Type of Shares'),
        currency: cellText(shRows[s], 'Currency'),
      });
    }

    return result;
  }, fileNumber);

  if (!details) {
    console.log('[details] Extraction returned null');
    return null;
  }

  if (details.companyName) {
    console.log('[details] Extracted:', details.companyName, '- directors:', details.directors.length,
      'shareholders:', details.shareholders.length, 'secretaries:', details.secretaries.length);
    return details as CompanyDetails;
  }

  console.log('[details] No company name found in dialog');
  return null;
}
