import type { Page } from 'patchright-core';

/**
 * Dismisses the cookie consent banner on onlinesearch.mns.mu.
 * The site uses a custom <mns-cookie> web component with CookieYes-style buttons.
 */
export async function dismissCookieConsent(page: Page): Promise<void> {
  try {
    // The cookie banner has buttons with class "cky-btn accept-btn" / "reject-btn"
    const acceptBtn = page.locator('.cky-btn.accept-btn, #accept-btn');
    if (await acceptBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await acceptBtn.first().click();
      console.log('Cookie consent dismissed');
      // Wait for banner to disappear
      await page.waitForTimeout(500);
      return;
    }

    // Fallback: try any accept/close button by text
    const fallbackBtn = page.getByRole('button', { name: /accept all|accept|close|got it/i });
    if (await fallbackBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await fallbackBtn.first().click();
      console.log('Cookie consent dismissed (fallback)');
      return;
    }

    console.log('No cookie consent banner found');
  } catch {
    console.log('Cookie consent banner not present or already dismissed');
  }
}
