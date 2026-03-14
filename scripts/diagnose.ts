/**
 * Diagnostic script: captures DOM state at each step of a search.
 * Run with: CBRD_USE_CHROMIUM=true npx tsx scripts/diagnose.ts
 */

import { chromium } from 'playwright-core';
import * as fs from 'fs';

async function diagnose() {
  console.log('Launching Chromium (headless)...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  // Step 1: Navigate
  console.log('\n--- Step 1: Navigate to CBRD ---');
  await page.goto('https://onlinesearch.mns.mu/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'scripts/diag-01-loaded.png', fullPage: true });
  console.log('Screenshot: diag-01-loaded.png');

  // Dump page title and URL
  console.log(`URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);

  // Step 2: Inspect all input elements
  console.log('\n--- Step 2: All input elements ---');
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(el => ({
      tag: el.tagName,
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      className: el.className,
      visible: el.offsetParent !== null,
    }));
  });
  console.log(JSON.stringify(inputs, null, 2));

  // Step 3: Inspect all button elements
  console.log('\n--- Step 3: All button elements ---');
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [type="submit"]')).map(el => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      text: el.textContent?.trim().substring(0, 100),
      className: el.className,
      visible: el.offsetParent !== null,
    }));
  });
  console.log(JSON.stringify(buttons, null, 2));

  // Step 4: Look for Angular Material / custom components
  console.log('\n--- Step 4: Custom web components ---');
  const customElements = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const customs = new Set<string>();
    for (const el of all) {
      if (el.tagName.includes('-')) {
        customs.add(el.tagName.toLowerCase());
      }
    }
    return Array.from(customs);
  });
  console.log('Custom elements found:', customElements);

  // Step 5: Try to find and fill search input
  console.log('\n--- Step 5: Finding search input ---');
  // Try multiple strategies
  const selectors = [
    'input[type="text"]',
    'input[type="search"]',
    'input[placeholder*="search" i]',
    'input[placeholder*="company" i]',
    'input[placeholder*="name" i]',
    'input[name*="search" i]',
    'mat-form-field input',
    '.search input',
    'input.form-control',
  ];

  let foundSelector: string | null = null;
  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    const visible = count > 0 ? await page.locator(sel).first().isVisible().catch(() => false) : false;
    console.log(`  ${sel}: count=${count}, visible=${visible}`);
    if (visible && !foundSelector) foundSelector = sel;
  }

  if (foundSelector) {
    console.log(`\nUsing selector: ${foundSelector}`);
    await page.locator(foundSelector).first().fill('Air Mauritius');
    await page.screenshot({ path: 'scripts/diag-02-filled.png', fullPage: true });
    console.log('Screenshot: diag-02-filled.png');

    // Step 6: Find and click search/submit
    console.log('\n--- Step 6: Finding submit button ---');
    const btnSelectors = [
      'button[type="submit"]',
      'button:has-text("Search")',
      'button:has-text("search")',
      'button mat-icon',
      '.mat-icon-button',
      'button.btn-primary',
      'button.search-btn',
    ];

    let foundBtn: string | null = null;
    for (const sel of btnSelectors) {
      const count = await page.locator(sel).count();
      const visible = count > 0 ? await page.locator(sel).first().isVisible().catch(() => false) : false;
      console.log(`  ${sel}: count=${count}, visible=${visible}`);
      if (visible && !foundBtn) foundBtn = sel;
    }

    if (foundBtn) {
      console.log(`\nClicking: ${foundBtn}`);
      await page.locator(foundBtn).first().click();
    } else {
      console.log('\nNo button found, pressing Enter');
      await page.locator(foundSelector).first().press('Enter');
    }

    // Wait for results
    console.log('\n--- Step 7: Waiting for results ---');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'scripts/diag-03-results.png', fullPage: true });
    console.log('Screenshot: diag-03-results.png');

    // Step 8: Dump the result area HTML
    console.log('\n--- Step 8: Page body HTML (first 10000 chars) ---');
    const html = await page.evaluate(() => document.body.innerHTML);
    fs.writeFileSync('scripts/diag-results.html', html);
    console.log(`Full HTML saved to scripts/diag-results.html (${html.length} chars)`);
    console.log(html.substring(0, 3000));

    // Step 9: Check for tables
    console.log('\n--- Step 9: Tables and table-like structures ---');
    const tables = await page.evaluate(() => {
      const results: Array<{tag: string, rows: number, firstRowText: string, className: string}> = [];
      // Regular tables
      for (const table of document.querySelectorAll('table')) {
        const rows = table.querySelectorAll('tr');
        results.push({
          tag: 'table',
          rows: rows.length,
          firstRowText: rows[0]?.textContent?.trim().substring(0, 200) ?? '',
          className: table.className,
        });
      }
      // mns-table-library
      for (const lib of document.querySelectorAll('mns-table-library')) {
        const shadow = (lib as any).shadowRoot;
        if (shadow) {
          const rows = shadow.querySelectorAll('tr');
          results.push({
            tag: 'mns-table-library (shadow)',
            rows: rows.length,
            firstRowText: rows[0]?.textContent?.trim().substring(0, 200) ?? '',
            className: lib.className,
          });
        } else {
          results.push({
            tag: 'mns-table-library (no shadow)',
            rows: 0,
            firstRowText: '',
            className: lib.className,
          });
        }
      }
      return results;
    });
    console.log(JSON.stringify(tables, null, 2));

    // Step 10: Check for result links (clickable rows)
    console.log('\n--- Step 10: All visible text content in main area ---');
    const mainText = await page.evaluate(() => {
      const main = document.querySelector('main, .main-content, .content, [role="main"], app-root, .mat-sidenav-content');
      if (main) return main.textContent?.trim().substring(0, 3000) ?? '';
      return document.body.textContent?.trim().substring(0, 3000) ?? '';
    });
    console.log(mainText);

  } else {
    console.log('No search input found!');
  }

  await browser.close();
  console.log('\nDiagnosis complete.');
}

diagnose().catch(console.error);
