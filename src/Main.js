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
    this.pages = []
    this.openPages = {}
    this.pagesAllocationCursor = 0
    this.operations = new Queue()
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
        case 'crawlDelay':
          return [500, 2500]
      }
    }
    return this.config.settings[setting]
  }

  /**
   * Instanciates the headless browser with 1 page per maxParallelPages setting.
   */
  async init () {
    this.browser = await puppeteer.launch()
    const promises = []
    for (let i = 0; i < this.getSetting('maxParallelPages'); i++) {
      const page = new Page(this)
      this.pages.push(page)
      promises.push(page.init(this.browser))
    }
    await Promise.all(promises)
  }

  /**
   * Populates the queue with initial operations and starts the main loop.
   *
   * Each entry point defines an URL from which some links may be followed.
   * Operations are processed in batch of up to 'maxParallelPages' pages (1 page
   * per URL).
   */
  async start (configOverride) {
    const entryPoints = configOverride || this.config.start
    if (!entryPoints) {
      throw Error('Error : missing start config')
    }

    // Begins with populating the initial URL(s) operation(s).
    for (let i = 0; i < entryPoints.length; i++) {
      const entryPoint = entryPoints[i]
      if (!entryPoint.url) {
        throw Error('Error : missing start url')
      }
      if (!entryPoint.follow) {
        throw Error('Error : missing start links to follow')
      }
      this.createInitialOps(entryPoint)
    }

    // Starts the process.
    while (this.operations.getKeysCount()) {
      const promises = []
      for (let j = 0; j < this.getSetting('maxParallelPages'); j++) {
        const url = this.operations.getNextKey(j)
        if (url) {
          promises.push(this.process(url))
        }
      }
      await Promise.all(promises)
    }
  }

  async stop () {
    await this.browser.close()
  }

  /**
   * Creates initial operations.
   */
  async createInitialOps (entryPoint) {
    for (let j = 0; j < entryPoint.follow.length; j++) {
      const op = entryPoint.follow[j]

      this.operations.addItem(entryPoint.url, {
        type: 'follow',
        selector: op.selector,
        to: op.to,
        maxPagesToCrawl: ('maxPagesToCrawl' in op) ? op.maxPagesToCrawl : 0,
        conf: { ...entryPoint }
      })

      if (op.cache) {
        this.operations.addItem(entryPoint.url, {
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
    const pageWorker = this.allocate(url)

    // Delay.
    const delayBounds = this.getSetting('crawlDelay')
    if (delayBounds && delayBounds.length) {
      const delayAmount = delayBounds[0] + (Math.random() * (delayBounds[1] - delayBounds[0]))
      await new Promise((resolve, reject) => setTimeout(resolve, delayAmount))
    }

    // Navigate to the URL
    await pageWorker.open(url)

    // Executes all operations queued for given URL.
    while (this.operations.getItemsCount(url)) {
      const op = this.operations.getItem(url)
      if (!op) {
        return
      }

      // Debug
      // console.log('Executing ' + url + " 'op' :" + op.type)
      // console.log(op)

      switch (op.type) {
        case 'follow':
          await this.crawl(pageWorker.page, op)
          break
        case 'extract':
          console.log('process.extract : ' + url + ' / op.conf.url = ' + op.conf.url)
          await this.extract(pageWorker.page, op)
          break
      }
    }
  }

  /**
   * Distributes operations among open pages by URL.
   */
  allocate (url) {
    // If an URL was already opened by a page, reuse the same.
    let pageAllocationCursor = this.pagesAllocationCursor
    if (url in this.openPages) {
      pageAllocationCursor = this.openPages[url]
    } else {
      this.openPages[url] = pageAllocationCursor
    }

    // Rotate the distribution among opened pages.
    this.pagesAllocationCursor++
    if (this.pagesAllocationCursor >= this.getSetting('maxParallelPages')) {
      this.pagesAllocationCursor = 0
    }

    // Debug.
    // console.log(`\nProcess ${url} using slot ${pageAllocationCursor + 1} / ${this.getSetting('maxParallelPages')}`)

    return this.pages[pageAllocationCursor]
  }

  /**
   * Finds links to follow and creates operations (which will then get reaped in
   * the main loop).
   *
   * Applies limits if set.
   */
  async crawl (page, op) {
    const urlsFound = await extract.linksUrl(page, op.selector)
    if (!urlsFound || !urlsFound.length) {
      return
    }

    for (let i = 0; i < urlsFound.length; i++) {
      const urlFound = urlsFound[i]

      // Prevent re-crawling the same URLs.
      if (this.crawledUrls.indexOf(urlFound) !== -1) {
        // Debug ok.
        // console.log("We've already crawled " + urlFound + ' -> skipping')
        continue
      }
      this.crawledUrls.push(urlFound)

      // Handle crawling limits.
      // We need to uniquely identify each "follow" block from config in order
      // to apply the limit. Given the way config is structured, for now, we
      // differenciate those blocks by concatenating the "to" key with the
      // selector.
      const limitID = op.to + ' :: ' + op.selector
      if (!(limitID in this.crawlLimits)) {
        this.crawlLimits[limitID] = 0
      }
      this.crawlLimits[limitID]++

      if (this.crawlLimits[limitID] > op.maxPagesToCrawl) {
        // Debug ok.
        // console.log("We've reached the crawling limit for " + limitID + ' : ' + this.crawlLimits[limitID])
        continue
      }

      // Debug.
      console.log(`${this.crawlLimits[limitID]} x ${limitID} for ${urlFound}`)

      // Execution depends on the "type" of link.
      if (op.to === 'start') {
        // Recursion (e.g. pager links).
        op.conf.url = urlFound
        this.createInitialOps(op.conf)
      } else {
        // Normal extraction.
        op.type = 'extract'
        this.operations.addItem(urlFound, op)
      }
    }
  }

  /**
   * TODO [wip] extraction process starting point.
   */
  async extract (page, op) {
    console.log('extraction TODO for url = ' + page.url())
    console.log('  (from ' + op.conf.url + ')')
    // console.log(op)
  }
}

module.exports = Main
