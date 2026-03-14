import { browserManager } from '../browser/manager.js';
import type { FinancialInfo } from '../types.js';

/**
 * Retrieve financial information for a company from the CBRD free search.
 */
export async function getFinancialInfo(fileNumber: string): Promise<FinancialInfo> {
  const page = await browserManager.getPage();

  // First, navigate to company details
  const { getCompanyDetails } = await import('./details.js');
  const companyDetails = await getCompanyDetails(fileNumber);

  // Look for a financials tab/section
  const financialsTab = page.locator('[data-tab*="financial" i], [class*="financial" i], a:has-text("Financial"), button:has-text("Financial"), [role="tab"]:has-text("Financial"), a:has-text("Annual Return"), button:has-text("Annual Return")');
  if (await financialsTab.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await financialsTab.first().click();
    await page.waitForLoadState(browserManager.waitUntil);
    await page.waitForTimeout(2000);
  }

  // Extract financial statements
  const financials = await page.evaluate((fn) => {
    const statements: Array<{
      year: string;
      filingDate?: string;
      type?: string;
      status?: string;
    }> = [];

    // Look for tables containing financial data
    const tables = document.querySelectorAll('table');
    for (const table of Array.from(tables)) {
      const headerText = table.textContent?.toLowerCase() || '';
      if (headerText.includes('financial') || headerText.includes('annual') || headerText.includes('return') || headerText.includes('statement')) {
        const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
        for (const row of Array.from(rows)) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 1) {
            statements.push({
              year: cells[0]?.textContent?.trim() || '',
              filingDate: cells[1]?.textContent?.trim() || undefined,
              type: cells[2]?.textContent?.trim() || undefined,
              status: cells[3]?.textContent?.trim() || undefined,
            });
          }
        }
      }
    }

    return { fileNumber: fn, statements };
  }, fileNumber);

  return {
    fileNumber,
    companyName: companyDetails.companyName,
    financialStatements: financials.statements,
  };
}
