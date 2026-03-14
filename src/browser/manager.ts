import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
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
      // Lightpanda requires WebSocket connection — convert http:// to ws:// if needed
      const wsUrl = cdpUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
      console.log(`Connecting to CDP browser at ${wsUrl}`);
      this.browser = await chromium.connectOverCDP(wsUrl);
      this.isCDP = true;
      // Lightpanda doesn't support Emulation.setUserAgentOverride, so pass empty options
      this.context = await this.browser.newContext({});
      this.page = await this.context.newPage();
    } else {
      // Launch local Chromium (for development)
      console.log('Launching local Chromium browser');
      this.browser = await chromium.launch({ headless: true });
      this.isCDP = false;
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
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
