/**
 * Diagnose the company details page — monitor network and try Playwright native click.
 * Run with: CBRD_USE_CHROMIUM=true npx tsx scripts/diagnose-details.ts
 */

import { chromium } from 'playwright-core';
import * as fs from 'fs';

async function diagnoseDetails() {
  console.log('Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  // Monitor all network requests
  const networkLog: string[] = [];
  page.on('request', (req) => {
    if (['xhr', 'fetch'].includes(req.resourceType())) {
      networkLog.push(`>>> ${req.method()} ${req.url()}`);
      const body = req.postData();
      if (body) networkLog.push(`    Body: ${body.substring(0, 300)}`);
    }
  });
  page.on('response', async (resp) => {
    if (['xhr', 'fetch'].includes(resp.request().resourceType())) {
      const status = resp.status();
      networkLog.push(`<<< ${status} ${resp.url()}`);
      try {
        const body = await resp.text();
        networkLog.push(`    Response: ${body.substring(0, 300)}`);
      } catch {}
    }
  });

  // Navigate and search
  console.log('Navigating...');
  await page.goto('https://onlinesearch.mns.mu/', { waitUntil: 'networkidle' });

  // Dismiss cookies
  const acceptBtn = page.locator('.cky-btn.accept-btn, #accept-btn');
  if (await acceptBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await acceptBtn.first().click();
    await page.waitForTimeout(500);
  }

  // Search for Air Mauritius
  console.log('Searching...');
  const input = page.locator('#company-partnership-text-field');
  await input.fill('Air Mauritius');

  networkLog.length = 0; // Clear network log before search
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector('table tbody tr', { timeout: 15_000 });
  await page.waitForTimeout(2000);

  console.log('\n--- Network during search ---');
  for (const line of networkLog) console.log(line);

  // Now clear and try clicking View
  networkLog.length = 0;
  console.log('\n--- Clicking View (Playwright native click) ---');

  // Use Playwright's click() on the first View icon
  const viewIcon = page.locator('fa-icon[title="View"]').first();
  await viewIcon.click({ timeout: 5000 });
  console.log('Click dispatched');

  // Wait for any network activity
  await page.waitForTimeout(8000);
  await page.waitForLoadState('networkidle').catch(() => {});

  console.log(`\nURL after: ${page.url()}`);
  console.log(`\n--- Network after View click ---`);
  for (const line of networkLog) console.log(line);

  // Screenshot
  await page.screenshot({ path: 'scripts/diag-details.png', fullPage: true });

  // Page text
  const text = await page.evaluate(() =>
    document.querySelector('app-root')?.textContent?.trim().substring(0, 3000) || ''
  );
  console.log('\n--- Page text ---');
  console.log(text);

  // Save HTML
  const html = await page.evaluate(() => document.body.innerHTML);
  fs.writeFileSync('scripts/diag-details.html', html);

  // Check for dialog/modal that might have opened
  const dialogs = await page.evaluate(() => {
    const modals = document.querySelectorAll('[class*="dialog"], [class*="modal"], [role="dialog"], mat-dialog-container, .cdk-overlay-container, .cdk-overlay-pane');
    return Array.from(modals).map(m => ({
      tag: m.tagName,
      className: m.className,
      text: m.textContent?.trim().substring(0, 500),
      visible: (m as HTMLElement).offsetParent !== null || m.querySelector('*'),
    }));
  });
  console.log('\n--- Dialogs/modals found ---');
  console.log(JSON.stringify(dialogs, null, 2));

  await browser.close();
}

diagnoseDetails().catch(console.error);
