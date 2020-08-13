const puppeteer = require('puppeteer')

/**
 * Main "simple scraps" class.
 */
class Main {
  constructor (config) {
    this.config = config
  }

  async init () {
    this.browser = await puppeteer.launch()
    this.page = await this.browser.newPage()
  }

  async start () {
    // TODO wip
  }

  async stop () {
    await this.browser.close()
  }

  async getContent () {
    return await this.page.content()
  }

  async findLinks (options, callback) {
    if (!options.url) {
      throw Error('Error : no URL to follow.')
    }

    // Defaults to look for all <a href="..."> in the page.
    const itemsSelector = options.selector || 'a[href]'

    await options.page.goto(options.url)
    await options.page.waitForSelector(itemsSelector)
    await options.page.evaluate((q) => {
      const anchors = Array.from(document.querySelectorAll(q))
      return anchors.map((anchor) => {
        callback(null, {
          op: 'extract',
          url: anchor.href
        })
      })
    }, itemsSelector)
  }
}

module.exports = Main
