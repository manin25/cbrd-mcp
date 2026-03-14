/**
 * Test the CBRD REST API to discover all mainOption values.
 * Run with: npx tsx scripts/test-api.ts
 */

const BASE_URL = 'https://onlinesearch.mns.mu/onlinesearch';

async function search(mainOption: string, searchValue: string): Promise<any> {
  const resp = await fetch(`${BASE_URL}/company`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mainOption,
      searchValue,
      dateIncorporatedFrom: null,
      dateIncorporatedTo: null,
      sortOrder: 'ASC',
      sortBy: 'ORG_NAME',
      pageSize: 5,
      pageNumber: 0,
    }),
  });
  return { status: resp.status, data: await resp.json().catch(() => resp.text()) };
}

async function testApi() {
  // Discover mainOption values
  // The radio buttons are: company-partnership, fileNo, businessName, brn
  const options = [
    { option: 'companyName', value: 'C1600', desc: 'companyName with file number' },
    { option: 'fileNumber', value: 'C1600', desc: 'fileNumber' },
    { option: 'fileNo', value: 'C1600', desc: 'fileNo' },
    { option: 'file_number', value: 'C1600', desc: 'file_number' },
    { option: 'FILE_NO', value: 'C1600', desc: 'FILE_NO' },
    { option: 'brn', value: 'C07000001', desc: 'brn' },
    { option: 'BRN', value: 'C07000001', desc: 'BRN' },
    { option: 'businessName', value: 'Air Mauritius', desc: 'businessName' },
    { option: 'business_name', value: 'Air Mauritius', desc: 'business_name' },
    { option: 'BUSINESS_NAME', value: 'Air Mauritius', desc: 'BUSINESS_NAME' },
    { option: 'company_name', value: 'Air Mauritius', desc: 'company_name' },
    { option: 'COMPANY_NAME', value: 'Air Mauritius', desc: 'COMPANY_NAME' },
  ];

  for (const { option, value, desc } of options) {
    const result = await search(option, value);
    const count = result.data?.totalElements ?? 'ERROR';
    console.log(`mainOption="${option}" value="${value}": ${count} results (${result.status})`);
    if (count > 0 && result.data?.result?.[0]) {
      console.log(`  First: ${JSON.stringify(result.data.result[0])}`);
    }
  }

  // Test details API with turnstile token header
  console.log('\n=== Details API exploration ===');
  const detailEndpoints = [
    `${BASE_URL}/company/viewCompanyDetails?orgNo=2699`,
    `${BASE_URL}/company/2699`,
    `${BASE_URL}/company/details?orgNo=2699`,
    `${BASE_URL}/company/C1600`,
  ];

  for (const url of detailEndpoints) {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    const text = await resp.text();
    console.log(`\nGET ${url}`);
    console.log(`  Status: ${resp.status}`);
    console.log(`  Response: ${text.substring(0, 300)}`);
  }
}

testApi().catch(console.error);
