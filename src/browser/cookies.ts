import type { Page } from 'playwright-core';

/**
 * Dismisses the cookie consent banner on onlinesearch.mns.mu.
 * The site uses a custom <mns-cookie> web component for the cookie notice.
 */
export async function dismissCookieConsent(page: Page): Promise<void> {
  try {
    // Try multiple strategies to dismiss the cookie banner

    // Strategy 1: Click the close/accept button inside the cookie banner
    const closeButton = page.locator('mns-cookie .close, mns-cookie [class*="close"], mns-cookie button, .cookie-close, .cookie-accept, [data-dismiss="cookie"]');
    if (await closeButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeButton.first().click();
      return;
    }

    // Strategy 2: Try to find any accept/close button by text
    const acceptButton = page.getByRole('button', { name: /accept|close|ok|got it|dismiss/i });
    if (await acceptButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptButton.first().click();
      return;
    }

    // Strategy 3: Remove the cookie element via JavaScript
    await page.evaluate(() => {
      const cookie = document.querySelector('mns-cookie');
      if (cookie) cookie.remove();
      // Also try shadow DOM
      document.querySelectorAll('[class*="cookie"]').forEach(el => {
        if (el.tagName !== 'SCRIPT') el.remove();
      });
    });
  } catch {
    // Cookie banner might not be present, which is fine
    console.log('No cookie consent banner found or already dismissed');
  }
}
