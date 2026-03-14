import type { FinancialInfo } from '../types.js';
import { lookupCompany } from './lookup.js';

/**
 * Retrieve financial information for a company.
 *
 * Note: Financial details require Cloudflare Turnstile verification and
 * may also require a paid CBRIS subscription. This function returns
 * basic company info and an empty financials array when detailed
 * financial data is not accessible.
 */
export async function getFinancialInfo(fileNumber: string): Promise<FinancialInfo> {
  // Get basic company info via browser-based lookup
  const searchResults = await lookupCompany(fileNumber, undefined);
  if (searchResults.length === 0) {
    throw new Error(`Company with file number "${fileNumber}" not found`);
  }

  const company = searchResults[0];

  // Financial statements are behind Turnstile verification and may require
  // a paid CBRIS subscription. Return basic info with empty financials.
  console.log(`Financial info for ${fileNumber}: detailed financials require Turnstile verification or CBRIS subscription`);

  return {
    fileNumber,
    companyName: company.companyName,
    financialStatements: [],
  };
}
