const cashPath = require.resolve('cash-dom')
const debug = require('debug')
const debugConsole = debug('simple-scraps:console')
// const debugDialog = debug('simple-scraps:dialog')

/**
 * Defines a single headless browser page "worker".
 *
 * Allows multiple pages to run at the same time.
 */
class Page {
  constructor (main) {
    this.main = main

    // TODO refactor reflexion :
    // To avoid component nesting problem (.c-card inside another component
    // -> multi matches from root to deepest nesting level), we need a way to
    // start extracting deepest levels + mark the component as extracted. Thus,
    // before actually extracting, we can check if a component was not
    // previously matched and already extracted.
    // This property on the Page object itself will store all component
    // extractors selectors (which are built recursively from config) in order
    // to sort them. We loose the entity object recursive structure that was
    // passively built, though. So we reconstruct an empty structure that will
    // be "hydrated" in a 2nd pass ?
    // this.extractionPlan = {}
  }

  /**
   * Instanciates the new page.
   */
  async init () {
    this.page = await this.main.browser.newPage()
    await this.page.setViewport({
      width: this.main.getSetting('pageW'),
      height: this.main.getSetting('pageH')
    })
  }

  /**
   * Attaches page event handlers and navigates to given URL.
   */
  async open (url) {
    this.page.on('pageerror', text => debugConsole(`${text} (in : ${url})`))
    // this.page.on('console', msg => console.log(`${msg.type()} ${msg.text()} at ${url}`))
    this.page.on('dialog', dialog => this.handleDialog(dialog, url))
    this.page.on('close', () => console.log('The browser page was closed.'))

    await this.page.goto(url)

    if (this.main.getSetting('addDomQueryHelper')) {
      await this.addDomQueryHelper()
    }
  }

  /**
   * Injects utility lib for quick DOM querying and manipulation.
   *
   * Unless jQuery already exists in the page to crawl.
   */
  async addDomQueryHelper () {
    // If jQuery is already loaded, make sure it's available in global scope as
    // the $() function. Otherwise, include the 'cash-dom' lib.
    /* istanbul ignore next */
    const jQueryExists = await this.page.evaluate(() => {
      // This function is running inside headless Chrome.
      if (typeof jQuery === 'function') {
        if (!window.$ || typeof window.$ !== 'function') {
          window.$ = jQuery
        }
        return true
      }
      return false
    })
    if (!jQueryExists) {
      await this.page.addScriptTag({ path: cashPath })
    }
  }

  /**
   * Returns the entire page HTML markup.
   */
  async getContent () {
    return await this.page.content()
  }

  /**
   * Deals with alerts.
   *
   * Taken from yujiosaka/headless-chrome-crawler.
   * See https://github.com/yujiosaka/headless-chrome-crawler/blob/master/lib/crawler.js
   */
  async handleDialog (dialog, url) {
    // debugDialog(`${dialog.type()} ${dialog.message()} at ${url}`)
    console.log(`${dialog.type()} ${dialog.message()} at ${url}`)
    await dialog.dismiss()
  }
}

module.exports = Page
