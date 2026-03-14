/**
 * Direct test script for CBRD MCP scraper functions.
 * Bypasses MCP protocol and tests each scraper directly.
 *
 * Run with: CBRD_USE_CHROMIUM=true npx tsx scripts/test-tools.ts
 */

import { searchCompany } from '../src/scraper/search.js';
import { lookupCompany } from '../src/scraper/lookup.js';
import { getCompanyDetails } from '../src/scraper/details.js';
import { searchPerson } from '../src/scraper/person-search.js';
import { getFinancialInfo } from '../src/scraper/financials.js';
import { browserManager } from '../src/browser/manager.js';

async function test(name: string, fn: () => Promise<unknown>): Promise<unknown> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    console.log(`✓ PASS (${elapsed}ms)`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    console.log(`✗ FAIL (${elapsed}ms)`);
    console.error(error);
    return null;
  }
}

async function main() {
  console.log('CBRD MCP Tool Test Suite');
  console.log(`CBRD_USE_CHROMIUM=${process.env.CBRD_USE_CHROMIUM}`);
  console.log(`CBRD_CDP_URL=${process.env.CBRD_CDP_URL ?? '(not set)'}`);

  // Test 1: Search company
  const searchResults = await test('cbrd_search_company("Air Mauritius")', () =>
    searchCompany('Air Mauritius', 5)
  ) as Array<{ fileNumber?: string }> | null;

  const fileNumber = searchResults?.[0]?.fileNumber;
  console.log(`\nFile number for next tests: ${fileNumber ?? 'NONE (search failed)'}`);

  // Test 2: Lookup company
  if (fileNumber) {
    await test(`cbrd_lookup_company(file_number="${fileNumber}")`, () =>
      lookupCompany(fileNumber, undefined)
    );
  } else {
    console.log('\nSKIP: cbrd_lookup_company (no file number from search)');
  }

  // Test 3: Company details
  if (fileNumber) {
    await test(`cbrd_company_details(file_number="${fileNumber}")`, () =>
      getCompanyDetails(fileNumber)
    );
  } else {
    console.log('\nSKIP: cbrd_company_details (no file number from search)');
  }

  // Test 4: Person search
  await test('cbrd_search_person("Ramgoolam")', () =>
    searchPerson('Ramgoolam')
  );

  // Test 5: Financial info
  if (fileNumber) {
    await test(`cbrd_financial_info(file_number="${fileNumber}")`, () =>
      getFinancialInfo(fileNumber)
    );
  } else {
    console.log('\nSKIP: cbrd_financial_info (no file number from search)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('ALL TESTS COMPLETE');
  console.log('='.repeat(60));

  await browserManager.shutdown();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  browserManager.shutdown().then(() => process.exit(1));
});
