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

    // Monitor network requests to understand what happens when View is clicked
    const apiCalls: { url: string; status: number; method: string }[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/') || url.includes('/cbris/') || url.includes('/company') || url.includes('/details')) {
        apiCalls.push({ url, status: response.status(), method: response.request().method() });
        console.log(`[details] API: ${response.request().method()} ${response.status()} ${url.substring(0, 120)}`);
      }
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

    console.log('[details] Search results loaded, API calls so far:', apiCalls.length);

    // Click the View icon
    const viewIcon = page.locator('fa-icon[title="View"]').first();
    await viewIcon.waitFor({ timeout: 5000 });
    await viewIcon.click();
    console.log('[details] View clicked (first time)');

    // Wait for CAPTCHA to be solved (or 30s timeout if none appears)
    console.log('[details] Waiting for CAPTCHA resolution...');
    await captchaPromise;

    // After CAPTCHA solved, DON'T reload — Turnstile token is in JS memory.
    // Wait for the dialog — Turnstile may have unblocked the pending API call.
    console.log('[details] CAPTCHA resolved — checking page state...');

    // Log Turnstile state
    const turnstileState = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="turnstile"]');
      const cfInput = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
      const results = document.querySelectorAll('lib-mns-universal-table table tbody tr');
      return {
        hasTurnstileIframe: !!iframe,
        hasCfToken: !!cfInput,
        cfTokenLength: cfInput?.value?.length || 0,
        resultRows: results.length,
        hasResultData: results.length > 0 && !!results[0].querySelector('td[data-column="Name"]'),
      };
    });
    console.log('[details] Turnstile state:', JSON.stringify(turnstileState));

    // Wait up to 5s for dialog to appear (original click may complete after Turnstile)
    let hasDialog = false;
    try {
      await page.waitForSelector('mat-dialog-container', { timeout: 5000 });
      hasDialog = true;
      console.log('[details] Dialog appeared after CAPTCHA solve!');
    } catch {
      console.log('[details] No dialog after 5s — will re-click View');
    }

    if (!hasDialog) {
      // Check if search results are still visible
      const hasResults = await page.evaluate(() => {
        const rows = document.querySelectorAll('lib-mns-universal-table table tbody tr');
        return rows.length > 0 && !!rows[0].querySelector('td[data-column="Name"]');
      });
      console.log('[details] Results still visible:', hasResults);

      if (!hasResults) {
        // Results disappeared — redo search WITHOUT reloading page
        console.log('[details] Results gone — redoing search in-place');
        await page.fill('#company-partnership-text-field', '');
        await page.click('#fileNo');
        await page.waitForTimeout(300);
        await page.fill('#company-partnership-text-field', fileNumber);
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => {
          const rows = document.querySelectorAll('lib-mns-universal-table table tbody tr');
          return rows.length > 0 && !!rows[0].querySelector('td[data-column="Name"]');
        }, { timeout: 15000 });
      }

      // Re-click View and watch for API calls
      const apiCountBefore = apiCalls.length;
      const viewIconRetry = page.locator('fa-icon[title="View"]').first();
      await viewIconRetry.waitFor({ timeout: 5000 });
      await viewIconRetry.click();
      console.log('[details] View re-clicked');

      // Wait a few seconds to see if any API call fires
      await page.waitForTimeout(3000);
      console.log('[details] API calls after re-click:', apiCalls.length - apiCountBefore);

      // Try waiting for dialog
      try {
        await page.waitForSelector('mat-dialog-container', { timeout: 10000 });
        hasDialog = true;
        console.log('[details] Dialog opened after re-click!');
      } catch {
        // Last resort: log comprehensive state
        const state = await page.evaluate(() => {
          const overlayContainer = document.querySelector('.cdk-overlay-container');
          const overlayPanes = overlayContainer?.querySelectorAll('.cdk-overlay-pane') || [];
          return {
            url: location.href,
            hasDialog: !!document.querySelector('mat-dialog-container'),
            overlayPanes: overlayPanes.length,
            overlayContent: overlayContainer?.innerHTML?.substring(0, 300) || '',
            hasTurnstile: !!document.querySelector('iframe[src*="turnstile"]'),
            turnstileWidgets: document.querySelectorAll('.cf-turnstile').length,
            bodyText: document.body.innerText.substring(0, 800),
          };
        });
        console.log('[details] Final state:', JSON.stringify(state));
      }
    }

    await page.waitForLoadState('networkidle').catch(() => {});

    // Expand all mat-expansion-panels so their table content is rendered in the DOM.
    // Collapsed panels use lazy rendering — tbody rows won't exist until expanded.
    await page.evaluate(() => {
      document.querySelectorAll('mat-expansion-panel-header').forEach(h => {
        const panel = h.closest('mat-expansion-panel');
        if (panel && !panel.classList.contains('mat-expanded')) {
          (h as HTMLElement).click();
        }
      });
    });
    await page.waitForTimeout(1000);

    // Diagnostic: dump DOM structure of financial panels + annual return panel
    const panelDiag = await page.evaluate(() => {
      const dialog = document.querySelector('mat-dialog-container');
      if (!dialog) return { error: 'no dialog' };

      function dumpPanel(keyword: string) {
        const panels = dialog!.querySelectorAll('mat-expansion-panel');
        for (let i = 0; i < panels.length; i++) {
          const title = panels[i].querySelector('mat-panel-title');
          if (title && (title.textContent || '').trim().toUpperCase().includes(keyword.toUpperCase())) {
            // Get inner HTML structure (truncated)
            const html = panels[i].innerHTML.substring(0, 3000);
            // Get all text rows with their structure
            const rows: string[] = [];
            panels[i].querySelectorAll('tr, .row, div[class*="row"]').forEach((r, idx) => {
              const tag = r.tagName.toLowerCase();
              const cls = r.className || '';
              const directText = Array.from(r.childNodes)
                .filter(n => n.nodeType === 3)
                .map(n => (n.textContent || '').trim())
                .filter(Boolean)
                .join('|');
              const cells: string[] = [];
              r.querySelectorAll('td, .col, span, label').forEach(c => {
                const t = (c.textContent || '').trim();
                if (t) cells.push(`<${c.tagName.toLowerCase()} class="${c.className}">${t.substring(0, 60)}`);
              });
              if (cells.length > 0) {
                rows.push(`[${idx}] <${tag} class="${cls.substring(0, 40)}"> directText="${directText}" cells=${JSON.stringify(cells).substring(0, 300)}`);
              }
            });
            // Also check for label.label / label.value pairs
            const labelPairs: string[] = [];
            panels[i].querySelectorAll('label.label').forEach(lbl => {
              const next = lbl.nextElementSibling;
              const val = next?.classList.contains('value') ? (next.textContent || '').trim() : '(no value sibling)';
              labelPairs.push(`${(lbl.textContent || '').trim()} => ${val.substring(0, 50)}`);
            });
            return { title: (title.textContent || '').trim(), rows, labelPairs, htmlSnippet: html.substring(0, 1500) };
          }
        }
        return null;
      }

      return {
        balanceSheet: dumpPanel('BALANCE SHEET'),
        profitAndLoss: dumpPanel('PROFIT AND LOSS'),
        annualReturn: dumpPanel('ANNUAL RETURN'),
        annualRegFee: dumpPanel('ANNUAL REGISTRATION FEE'),
      };
    });
    console.log('[details] DIAG balance sheet:', JSON.stringify(panelDiag.balanceSheet)?.substring(0, 2000));
    console.log('[details] DIAG P&L:', JSON.stringify(panelDiag.profitAndLoss)?.substring(0, 2000));
    console.log('[details] DIAG annual return:', JSON.stringify(panelDiag.annualReturn)?.substring(0, 2000));
    console.log('[details] DIAG annual reg fee:', JSON.stringify(panelDiag.annualRegFee)?.substring(0, 2000));

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

    // --- MEMBERS (Company Limited by Guarantee) ---
    var memRows = getPanelTableRows('MEMBERS');
    var members: any[] = [];
    for (var m = 0; m < memRows.length; m++) {
      var memName = cellText(memRows[m], 'Name');
      if (!memName) continue;
      members.push({
        name: memName,
        amount: cellText(memRows[m], 'Amount'),
        startDate: cellText(memRows[m], 'Start Date'),
        currency: cellText(memRows[m], 'Currency'),
      });
    }
    result.members = members;

    // --- CERTIFICATES (Issued by Other Institutions) ---
    var certRows = getPanelTableRows('CERTIFICATE');
    var certificates: any[] = [];
    for (var ct = 0; ct < certRows.length; ct++) {
      var certName = cellText(certRows[ct], 'Certificate') || cellText(certRows[ct], 'Certificate Type');
      if (!certName) continue;
      certificates.push({
        certificate: certName,
        type: cellText(certRows[ct], 'Type'),
        effectiveDate: cellText(certRows[ct], 'Effective Date'),
        expiryDate: cellText(certRows[ct], 'Expiry Date'),
      });
    }
    result.certificates = certificates;

    // --- ANNUAL RETURNS FILED ---
    var arRows = getPanelTableRows('ANNUAL RETURN');
    var annualReturns: any[] = [];
    for (var ar = 0; ar < arRows.length; ar++) {
      var arDate = cellText(arRows[ar], 'Date Annual Return');
      if (!arDate) continue;
      annualReturns.push({
        dateAnnualReturn: arDate,
        annualMeetingDate: cellText(arRows[ar], 'Annual Meeting Date'),
        dateFiled: cellText(arRows[ar], 'Date Filed'),
      });
    }
    result.annualReturns = annualReturns;

    // --- FINANCIAL SUMMARY/STATEMENTS FILED ---
    var fsRows = getPanelTableRows('FINANCIAL SUMMARY');
    var financialSummaries: any[] = [];
    for (var fs = 0; fs < fsRows.length; fs++) {
      var fyEnded = cellText(fsRows[fs], 'Financial Year Ended');
      if (!fyEnded) continue;
      financialSummaries.push({
        financialYearEnded: fyEnded,
        currency: cellText(fsRows[fs], 'Currency'),
        dateApproved: cellText(fsRows[fs], 'Date Approved'),
      });
    }
    result.financialSummaries = financialSummaries;

    // --- PROFIT AND LOSS STATEMENT + BALANCE SHEET ---
    // CBRIS uses separate panels: "PROFIT AND LOSS STATEMENT" and "BALANCE SHEET"
    // Each panel has label/value pairs for header fields and line items for financials

    // Helper: find a panel element by title keyword
    function findPanel(keyword: string): Element | null {
      var panels = dialog!.querySelectorAll('mat-expansion-panel');
      for (var fp = 0; fp < panels.length; fp++) {
        var title = panels[fp].querySelector('mat-panel-title');
        if (title && (title.textContent || '').trim().toUpperCase().includes(keyword.toUpperCase())) {
          return panels[fp];
        }
      }
      return null;
    }

    // Helper: get label.value field scoped to a specific panel
    function getPanelField(panel: Element, labelText: string): string | undefined {
      var labels = panel.querySelectorAll('label.label');
      for (var pfi = 0; pfi < labels.length; pfi++) {
        var text = (labels[pfi].textContent || '').replace(':', '').trim().toLowerCase();
        if (text === labelText.toLowerCase()) {
          var valueEl = labels[pfi].nextElementSibling;
          if (valueEl && valueEl.classList.contains('value')) {
            var val = (valueEl.textContent || '').trim();
            if (val) return val;
          }
        }
      }
      return undefined;
    }

    // Helper: get financial line item value from a panel — searches rows for text label and numeric value
    function getLineItem(panel: Element, itemText: string): string | undefined {
      var allRows = panel.querySelectorAll('tr, .row, div[class*="row"]');
      for (var li = 0; li < allRows.length; li++) {
        var rowText = (allRows[li].textContent || '').trim();
        if (rowText.toLowerCase().includes(itemText.toLowerCase())) {
          // Get the last number-like text in the row
          var cells = allRows[li].querySelectorAll('td, .col, span, label.value');
          for (var lci = cells.length - 1; lci >= 0; lci--) {
            var cellVal = (cells[lci].textContent || '').trim();
            if (cellVal && /^-?[\d,]+\.?\d*$/.test(cellVal.replace(/,/g, ''))) {
              return cellVal;
            }
          }
        }
      }
      return undefined;
    }

    var plPanel = findPanel('PROFIT AND LOSS');
    var bsPanel = findPanel('BALANCE SHEET');

    if (plPanel || bsPanel) {
      // Get header fields from whichever panel has them (P&L panel usually has them)
      var finHeaderPanel = plPanel || bsPanel;
      result.lastFinancialSummary = {
        financialYearEnded: finHeaderPanel ? getPanelField(finHeaderPanel, 'Financial Year Ended') : undefined,
        currency: finHeaderPanel ? getPanelField(finHeaderPanel, 'Currency') : undefined,
        dateApproved: finHeaderPanel ? getPanelField(finHeaderPanel, 'Date Approved') : undefined,
        unit: finHeaderPanel ? getPanelField(finHeaderPanel, 'Unit') : undefined,
        profitAndLoss: plPanel ? {
          turnover: getLineItem(plPanel, 'Turnover'),
          costOfSales: getLineItem(plPanel, 'Cost of Sales'),
          grossProfit: getLineItem(plPanel, 'Gross Profit'),
          otherIncome: getLineItem(plPanel, 'Other Income'),
          distributionCosts: getLineItem(plPanel, 'Distribution Costs'),
          administrationCosts: getLineItem(plPanel, 'Administration Costs'),
          otherExpenses: getLineItem(plPanel, 'Other Expenses'),
          financeCosts: getLineItem(plPanel, 'Finance Costs'),
          profitBeforeTax: getLineItem(plPanel, 'Before Tax'),
          taxExpense: getLineItem(plPanel, 'Tax Expense'),
          profitForPeriod: getLineItem(plPanel, 'For The Period') || getLineItem(plPanel, 'FOR THE PERIOD'),
          totalComprehensiveIncome: getLineItem(plPanel, 'Total Comprehensive Income'),
        } : undefined,
        balanceSheet: bsPanel ? {
          nonCurrentAssets: {
            propertyPlantEquipment: getLineItem(bsPanel, 'Property, Plant and Equipment'),
            investmentProperties: getLineItem(bsPanel, 'Investment Properties'),
            intangibleAssets: getLineItem(bsPanel, 'Intangible Assets'),
            otherInvestments: getLineItem(bsPanel, 'Other Investments'),
            investmentInSubsidiaries: getLineItem(bsPanel, 'Investment in Subsidiaries'),
            biologicalAssets: getLineItem(bsPanel, 'Biological Assets'),
          },
          currentAssets: {
            inventories: getLineItem(bsPanel, 'Inventories'),
            tradeAndOtherReceivables: getLineItem(bsPanel, 'Trade and Other Receivables'),
            cashAndCashEquivalents: getLineItem(bsPanel, 'Cash and Cash Equivalents'),
          },
          totalAssets: getLineItem(bsPanel, 'Total Assets') || getLineItem(bsPanel, 'TOTAL ASSETS'),
          equityAndLiabilities: {
            shareCapital: getLineItem(bsPanel, 'Share Capital'),
            otherReserves: getLineItem(bsPanel, 'Other Reserves'),
            retainedEarnings: getLineItem(bsPanel, 'Retained Earnings'),
          },
          nonCurrentLiabilities: {
            longTermBorrowings: getLineItem(bsPanel, 'Long Term Borrowings'),
            deferredTax: getLineItem(bsPanel, 'Deferred Tax'),
            longTermProvisions: getLineItem(bsPanel, 'Long Term Provisions'),
          },
          currentLiabilities: {
            tradeAndOtherPayables: getLineItem(bsPanel, 'Trade and Other Payables'),
            shortTermBorrowings: getLineItem(bsPanel, 'Short Term Borrowings'),
            currentTaxPayable: getLineItem(bsPanel, 'Current Tax Payable'),
            shortTermProvisions: getLineItem(bsPanel, 'Short Term Provisions'),
          },
          totalLiabilities: getLineItem(bsPanel, 'Total Liabilities') || getLineItem(bsPanel, 'TOTAL LIABILITIES'),
          totalEquityAndLiabilities: getLineItem(bsPanel, 'Total Equity and Liabilities') || getLineItem(bsPanel, 'TOTAL EQUITY AND LIABILITIES'),
        } : undefined,
      };
    }

    // --- ANNUAL REGISTRATION FEE (separate panel on CBRIS) ---
    var feePanel = findPanel('ANNUAL REGISTRATION FEE');
    if (feePanel) {
      result.lastAnnualRegistrationFeePaid = getPanelField(feePanel, 'Last Annual Registration Fee Paid')
        || (feePanel.textContent || '').replace(/[^0-9]/g, '').trim() || undefined;
    }

    // --- CHARGES ---
    var chgRows = getPanelTableRows('CHARGES');
    var charges: any[] = [];
    for (var ch = 0; ch < chgRows.length; ch++) {
      var chVol = cellText(chgRows[ch], 'Volume');
      var chProp = cellText(chgRows[ch], 'Property');
      var chNat = cellText(chgRows[ch], 'Nature');
      if (chVol || chProp || chNat) {
        charges.push({
          volume: chVol,
          property: chProp,
          nature: chNat,
          amount: cellText(chgRows[ch], 'Amount'),
          dateCharged: cellText(chgRows[ch], 'Date Charged'),
          dateFiled: cellText(chgRows[ch], 'Date Filed'),
          currency: cellText(chgRows[ch], 'Currency'),
        });
      }
    }
    result.charges = charges;

    // --- REMOVAL / WINDING UP DETAILS ---
    var wuRows = getPanelTableRows('REMOVAL') || getPanelTableRows('WINDING UP');
    var windingUp: any[] = [];
    for (var wu = 0; wu < wuRows.length; wu++) {
      var wuType = cellText(wuRows[wu], 'Type');
      if (!wuType) continue;
      windingUp.push({
        type: wuType,
        startDate: cellText(wuRows[wu], 'Start Date'),
        endDate: cellText(wuRows[wu], 'End Date'),
        status: cellText(wuRows[wu], 'Status'),
      });
    }
    result.windingUp = windingUp;

    // --- OBJECTIONS ---
    var objRows = getPanelTableRows('OBJECTION');
    var objections: any[] = [];
    for (var ob = 0; ob < objRows.length; ob++) {
      var objDate = cellText(objRows[ob], 'Objection Date');
      if (!objDate) continue;
      objections.push({
        objectionDate: objDate,
        objector: cellText(objRows[ob], 'Objector'),
      });
    }
    result.objections = objections;

    // --- EXTRACT OF FILE WITH ADDITIONAL COMMENTS ---
    var noteRows = getPanelTableRows('EXTRACT');
    var extractNotes: any[] = [];
    for (var en = 0; en < noteRows.length; en++) {
      var noteId = cellText(noteRows[en], 'SerialID') || cellText(noteRows[en], 'Serial');
      var noteText = cellText(noteRows[en], 'Notes');
      if (noteId || noteText) {
        extractNotes.push({
          serialId: noteId,
          notes: noteText,
        });
      }
    }
    result.extractNotes = extractNotes;

    return result;
  }, fileNumber);

  if (!details) {
    console.log('[details] Extraction returned null');
    return null;
  }

  if (details.companyName) {
    console.log('[details] Extracted:', details.companyName,
      '- directors:', details.directors.length,
      'shareholders:', details.shareholders.length,
      'secretaries:', details.secretaries.length,
      'charges:', details.charges?.length || 0,
      'financials:', details.lastFinancialSummary ? 'yes' : 'no');
    return details as CompanyDetails;
  }

  console.log('[details] No company name found in dialog');
  return null;
}
