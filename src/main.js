const puppeteer = require('puppeteer')
const Queue = require('./queue')
const cashPath = require.resolve('cash-dom')

/**
 * Main "simple scraps" class.
 *
 * Overview :
 * - queue : contains all operations that should run before the entire process
 *  comes to an end.
 * - follow : opens URL and performs queued operation(s) associated to it.
 * - extract : once opened, this part is in charge of processing the pages DOM
 *    to extract structured data according to rules declared in config.
 */
class Main {
  constructor (config) {
    this.config = config
  }

  /**
   * Instanciates Puppeteer, the operation queue, and pages.
   */
  async init () {
    this.queue = new Queue()
    this.open_pages = []
    this.browser = await puppeteer.launch()
  }

  /**
   * Populates the queue with initial operations.
   *
   * Each start item defines an URL from which some links may be followed.
   */
  async start () {
    if (!this.config.start) {
      throw Error('Error : missing start config')
    }

    // Begins with populating the initial URL(s) operation(s).
    for (let i = 0; i < this.config.start.length; i++) {
      const start = this.config.start[i]
      if (!start.url) {
        throw Error('Error : missing start url')
      }
      if (!start.follow) {
        throw Error('Error : missing start extraction definition')
      }

      for (let j = 0; j < start.follow.length; j++) {
        const follow = start.follow[j]
        this.queue.addItem(start.url, {
          op: 'findLinks',
          selector: follow.selector,
          to: follow.to
        })
        if (follow.cache) {
          this.queue.addItem(start.url, {
            op: 'cache'
          })
        }
      }
    }

    // Starts the process by taking the first URL.
  }

  /**
   * Begins processing queued operations by page.
   *
   * Every URL can have 1 or more operations associated. Once opened, we reuse
   * the same Puppeteer page for all operations to be carried out by URL.
   */
  async process (url) {
    const pageData = this.queue.getItem(url)
    if (!pageData) {
      return
    }
    const page = await this.browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await page.addScriptTag({ path: cashPath })
    this.open_pages.push(page)
  }

  async stop () {
    await this.browser.close()
  }

  async getContent () {
    return await this.page.content()
  }

  async findLinks (options) {
    if (!options.url) {
      throw Error('Error : no URL to follow.')
    }

    // Defaults to look for all <a href="..."> in the page.
    const itemsSelector = options.selector || 'a[href]'

    await this.page.goto(options.url)
    await this.page.waitForSelector(itemsSelector)
    await this.page.evaluate((s, q) => {
      const anchors = Array.from(document.querySelectorAll(s))
      return anchors.map((anchor) => {
        // TODO [wip]
        q.addItem(options.url, {
          op: 'follow',
          url: anchor.href
        })
      })
    }, itemsSelector, this.queue)
  }
}

module.exports = Main
