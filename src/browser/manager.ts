import { chromium, type Browser, type BrowserContext, type Page } from 'patchright-core';
import { dismissCookieConsent } from './cookies.js';

const CBRD_URL = 'https://onlinesearch.mns.mu/';

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private initializing: Promise<Page> | null = null;
  private isCDP = false;

  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    // Prevent concurrent initialization
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.initBrowser();
    try {
      const page = await this.initializing;
      return page;
    } finally {
      this.initializing = null;
    }
  }

  private async initBrowser(): Promise<Page> {
    await this.cleanup();

    const cdpUrl = process.env.CBRD_CDP_URL;
    const useChromium = process.env.CBRD_USE_CHROMIUM === 'true';

    if (cdpUrl && !useChromium) {
      console.log(`Connecting to CDP browser at ${cdpUrl}`);
      this.browser = await chromium.connectOverCDP(cdpUrl);
      this.isCDP = true;
      // Lightpanda has limited CDP support: no Target.createBrowserContext,
      // no Emulation.setUserAgentOverride. Use the default context and its existing page.
      const contexts = this.browser.contexts();
      this.context = contexts[0];
      if (!this.context) {
        throw new Error('No default browser context found from CDP connection');
      }
      // Use the existing page from Lightpanda (creating new pages may not be supported)
      const pages = this.context.pages();
      this.page = pages[0] ?? await this.context.newPage();
      console.log(`CDP connected: ${contexts.length} contexts, ${pages.length} pages, page URL: ${this.page.url()}`);
    } else {
      // Launch local Chromium via patchright (stealth-patched Playwright)
      // Do NOT set a custom userAgent — patchright's stealth depends on the
      // real Chromium UA matching TLS/JS fingerprints to pass Turnstile.
      console.log('Launching local Chromium browser (patchright stealth)');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
      });
      this.isCDP = false;
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
    }
    this.page.setDefaultTimeout(30_000);
    this.page.setDefaultNavigationTimeout(30_000);

    // Navigate to CBRD and handle cookie consent
    await this.page.goto(CBRD_URL, { waitUntil: this.waitUntil });
    await dismissCookieConsent(this.page);

    return this.page;
  }

  async navigateTo(url: string): Promise<Page> {
    const page = await this.getPage();
    const currentUrl = page.url();
    if (!currentUrl.startsWith(url)) {
      await page.goto(url, { waitUntil: this.waitUntil });
    }
    return page;
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    } catch { /* ignore */ }
    try {
      if (this.context) {
        await this.context.close();
      }
    } catch { /* ignore */ }
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch { /* ignore */ }
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  /** Returns the appropriate wait strategy: 'load' for Lightpanda CDP, 'networkidle' for Chromium */
  get waitUntil(): 'load' | 'networkidle' {
    return this.isCDP ? 'load' : 'networkidle';
  }

  async shutdown(): Promise<void> {
    await this.cleanup();
  }
}

// Singleton instance
export const browserManager = new BrowserManager();
