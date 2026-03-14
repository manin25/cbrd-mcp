/**
 * API Discovery Script
 *
 * Launches a browser, navigates to onlinesearch.mns.mu, and intercepts
 * all XHR/fetch requests to discover the underlying REST API endpoints.
 *
 * Run with: npm run discover-api
 *
 * This is a development tool — run it locally with Chromium to map out
 * the API surface before building scrapers.
 */

import { chromium } from 'playwright-core';

interface ApiCall {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseStatus?: number;
  responseBody?: string;
}

async function discoverApi(): Promise<void> {
  const apiCalls: ApiCall[] = [];

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept all network requests
  page.on('request', (request) => {
    const url = request.url();
    const resourceType = request.resourceType();

    // Only track API-like requests
    if (['xhr', 'fetch'].includes(resourceType) ||
        (url.includes('/api/') || url.includes('/search') || url.includes('/company'))) {
      const call: ApiCall = {
        method: request.method(),
        url: url,
        requestHeaders: request.headers(),
        requestBody: request.postData() ?? undefined,
      };
      apiCalls.push(call);
      console.log(`\n>>> ${call.method} ${call.url}`);
      if (call.requestBody) {
        console.log(`    Body: ${call.requestBody.substring(0, 500)}`);
      }
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    const request = response.request();
    const resourceType = request.resourceType();

    if (['xhr', 'fetch'].includes(resourceType) ||
        (url.includes('/api/') || url.includes('/search') || url.includes('/company'))) {
      const status = response.status();
      console.log(`<<< ${status} ${url}`);

      try {
        const body = await response.text();
        console.log(`    Response (first 500 chars): ${body.substring(0, 500)}`);

        // Update the matching API call
        const call = apiCalls.find(c => c.url === url && !c.responseStatus);
        if (call) {
          call.responseStatus = status;
          call.responseBody = body.substring(0, 2000);
        }
      } catch {
        console.log(`    (Could not read response body)`);
      }
    }
  });

  console.log('\nNavigating to onlinesearch.mns.mu...');
  await page.goto('https://onlinesearch.mns.mu/', { waitUntil: 'networkidle' });

  console.log('\nPage loaded. Waiting 5 seconds for dynamic content...');
  await page.waitForTimeout(5000);

  // Take a screenshot for reference
  await page.screenshot({ path: 'scripts/homepage.png', fullPage: true });
  console.log('Screenshot saved to scripts/homepage.png');

  // Log page content for analysis
  const bodyHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 5000));
  console.log('\n=== PAGE BODY (first 5000 chars) ===');
  console.log(bodyHtml);

  // Try to interact with search if visible
  console.log('\n=== LOOKING FOR SEARCH ELEMENTS ===');
  const inputs = await page.locator('input').all();
  for (const input of inputs) {
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    const placeholder = await input.getAttribute('placeholder');
    const id = await input.getAttribute('id');
    console.log(`Input: type=${type}, name=${name}, placeholder=${placeholder}, id=${id}`);
  }

  const buttons = await page.locator('button, [type="submit"]').all();
  for (const btn of buttons) {
    const text = await btn.textContent();
    const type = await btn.getAttribute('type');
    console.log(`Button: text="${text?.trim()}", type=${type}`);
  }

  const links = await page.locator('a').all();
  for (const link of links) {
    const text = await link.textContent();
    const href = await link.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
      console.log(`Link: text="${text?.trim()}", href=${href}`);
    }
  }

  // Try typing in a search box if found
  const searchInput = page.locator('input[type="text"], input[type="search"], input[name*="search"], input[placeholder*="search" i], input[placeholder*="company" i], input[placeholder*="name" i]');
  if (await searchInput.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('\n=== PERFORMING TEST SEARCH ===');
    await searchInput.first().fill('Air Mauritius');
    await page.waitForTimeout(1000);

    // Try clicking a search button
    const searchBtn = page.locator('button[type="submit"], button:has-text("Search"), button:has-text("search"), .search-btn, [class*="search"]');
    if (await searchBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchBtn.first().click();
      await page.waitForTimeout(5000);

      // Take screenshot of results
      await page.screenshot({ path: 'scripts/search-results.png', fullPage: true });
      console.log('Search results screenshot saved to scripts/search-results.png');
    }
  }

  // Summary
  console.log('\n\n=== API CALLS SUMMARY ===');
  console.log(`Total intercepted calls: ${apiCalls.length}`);
  for (const call of apiCalls) {
    console.log(`\n${call.method} ${call.url}`);
    console.log(`  Status: ${call.responseStatus ?? 'pending'}`);
    if (call.requestBody) console.log(`  Request: ${call.requestBody.substring(0, 200)}`);
    if (call.responseBody) console.log(`  Response: ${call.responseBody.substring(0, 200)}`);
  }

  console.log('\n\nBrowser will stay open for 30 seconds for manual inspection...');
  console.log('You can interact with the page manually during this time.');
  await page.waitForTimeout(30000);

  await browser.close();
  console.log('Done!');
}

discoverApi().catch(console.error);
