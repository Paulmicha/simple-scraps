const puppeteer = require('puppeteer')
const Page = require('./Page')
const Queue = require('./Queue')
const extract = require('./extract')

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
    this.crawledUrls = []
    this.crawlLimits = {}
  }

  /**
   * General config getter.
   *
   * Also provides default settings.
   */
  getSetting (setting) {
    if (!('settings' in this.config)) {
      this.config.settings = {}
    }
    if (!(setting in this.config.settings)) {
      switch (setting) {
        case 'addDomQueryHelper':
          return true
        case 'maxParallelPages':
          return 4
      }
    }
    return this.config.settings[setting]
  }

  /**
   * Instanciates Puppeteer and the operation queue.
   */
  async init () {
    this.queue = new Queue()
    this.browser = await puppeteer.launch()

    this.pageWorker = new Page(this)
    await this.pageWorker.init(this.browser)
    this.page = this.pageWorker.page
  }

  /**
   * Populates the queue with initial operations.
   *
   * Each start item defines an URL from which some links may be followed.
   */
  async start (configOverride) {
    const config = configOverride || this.config.start
    if (!config) {
      throw Error('Error : missing start config')
    }

    // Begins with populating the initial URL(s) operation(s).
    for (let i = 0; i < config.length; i++) {
      const start = config[i]
      if (!start.url) {
        throw Error('Error : missing start url')
      }
      if (!start.follow) {
        throw Error('Error : missing start links to follow')
      }
      this.createInitialOps(start)
    }

    // Starts the process.
    while (this.queue.getKeysCount()) {
      const url = this.queue.getNextKey()
      if (!url) {
        break
      }
      await this.process(url)
    }
  }

  /**
   * Creates initial operations.
   */
  async createInitialOps (start) {
    for (let j = 0; j < start.follow.length; j++) {
      const op = start.follow[j]

      this.queue.addItem(start.url, {
        type: 'follow',
        selector: op.selector,
        to: op.to,
        maxPagesToCrawl: ('maxPagesToCrawl' in op) ? op.maxPagesToCrawl : 0,
        conf: start
      })

      if (op.cache) {
        this.queue.addItem(start.url, {
          type: 'cache'
        })
      }
    }
  }

  /**
   * Begins processing queued operations by page.
   *
   * Every URL can have 1 or more operations associated. Once opened, we reuse
   * the same Puppeteer page for all operations to be carried out by URL.
   */
  async process (url) {
    await this.pageWorker.open(url)
    await this.execOps(url)
  }

  /**
   * Executes all operations queued for given URL.
   */
  async execOps (url) {
    while (this.queue.getItemsCount(url)) {
      const op = this.queue.getItem(url)
      if (!op) {
        return
      }

      // Debug
      // console.log('Executing ' + url + " 'op' :")
      // console.log(op)

      switch (op.type) {
        case 'follow':
          await extract.linksUrl(this, this.page, url, op)
          break
      }
    }
  }

  async stop () {
    await this.browser.close()
  }
}

module.exports = Main
