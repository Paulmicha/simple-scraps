const EventEmitter = require('events')
const puppeteer = require('puppeteer')
const Page = require('./Page')
const Queue = require('./Queue')
const extract = require('./extract')
const cache = require('./cache')
const fs = require('fs')

/**
 * Main "simple scraps" class.
 *
 * Overview :
 * - queue : contains all operations that should run before the entire process
 *  comes to an end.
 * - crawl : opens given URL and queues new operation(s) (crawl or extract).
 * - extract : outputs structured data according to rules declared in config.
 */
class Main extends EventEmitter {
  constructor (config) {
    super()
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
        // TODO device emulation (i.e. mobile) ?
        case 'pageW':
          return 1280
        case 'pageH':
          return 800
        case 'addDomQueryHelper':
          return true
        case 'maxParallelPages':
          return 4
        case 'crawlDelay':
          return [500, 2500]
        // TODO instead, leave more options inside each "follow" config. E.g.
        // screenshot format, quality, device emulation / resolution, etc.
        // -> Deprecated.
        case 'cacheWithScreenshot':
          return true
        case 'cacheSkipExisiting':
          return true
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
      promises.push(page.init())
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
  async start () {
    const entryPoints = this.config.start
    if (!entryPoints) {
      throw Error('Missing start config')
    }

    // Begins with populating the initial URL(s) operation(s).
    for (let i = 0; i < entryPoints.length; i++) {
      const entryPoint = entryPoints[i]
      if (!entryPoint.url) {
        throw Error('Missing start url')
      }
      if (!entryPoint.follow) {
        throw Error('Missing start links to follow')
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
   * Creates initial operations (adds new pages to crawl).
   */
  async createInitialOps (entryPoint) {
    for (let j = 0; j < entryPoint.follow.length; j++) {
      const op = entryPoint.follow[j]

      this.operations.addItem(entryPoint.url, {
        type: 'crawl',
        selector: op.selector,
        to: op.to,
        cache: op.cache,
        maxPagesToCrawl: ('maxPagesToCrawl' in op) ? op.maxPagesToCrawl : 0,
        conf: { ...entryPoint }
      })
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

    // Navigate to the URL.
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
        case 'crawl':
          await this.crawl(pageWorker, op)
          break
        case 'extract':
          if (op.cache) {
            await this.cache(pageWorker, op)
          }
          await this.extract(pageWorker, op)
          break
      }
    }
  }

  /**
   * Distributes operations among open pages by URL.
   */
  allocate (url) {
    // If an URL was already opened by a page, reuse the same.
    let cursor = this.pagesAllocationCursor
    if (url in this.openPages) {
      cursor = this.openPages[url]
    } else {
      this.openPages[url] = cursor
    }

    // Rotate the distribution among opened pages.
    this.pagesAllocationCursor++
    if (this.pagesAllocationCursor >= this.getSetting('maxParallelPages')) {
      this.pagesAllocationCursor = 0
    }

    // Debug.
    // console.log(`\nProcess ${url} using slot ${cursor + 1} / ${this.getSetting('maxParallelPages')}`)

    return this.pages[cursor]
  }

  /**
   * Finds links to follow and creates operations (which will then get reaped in
   * the main loop).
   *
   * Applies limits if set.
   */
  async crawl (pageWorker, op) {
    const urlsFound = await extract.linksUrl(pageWorker.page, op.selector)
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
        // NB. createInitialOps() will set op.type = 'crawl'.
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
   * Caching process starting point.
   */
  async cache (pageWorker, op) {
    const url = pageWorker.page.url()

    // Debug.
    // console.log('Caching page ' + url)

    // Save page markup.
    const pageContent = await pageWorker.getContent()
    cache.writePageMarkup(url, pageContent, this.getSetting('cacheSkipExisiting'))

    // Save a screenshot.
    if (this.getSetting('cacheWithScreenshot')) {
      let suffix = '.screenshot-'
      suffix += this.getSetting('pageW') + 'x' + this.getSetting('pageH')
      suffix += '.png'
      const filePath = cache.getFilePath(url, suffix)
      if (this.getSetting('cacheSkipExisiting') && fs.existsSync(filePath)) {
        return
      }
      await pageWorker.page.screenshot({
        path: filePath,
        fullPage: true
      })
    }
  }

  /**
   * Extraction process starting point.
   */
  async extract (pageWorker, op) {
    if (!('to' in op)) {
      throw Error('Missing extraction destination (to)')
    }

    // Prepare the entity that will be extracted (each extractor deals with
    // a part of the same entity).
    const [entityType, bundle] = op.to.split('/')
    const entity = {}

    // Get all defined extractors that match current destination.
    const extractors = extract.match(entityType, this)

    // Chain all extractors that need to run on given page to build our entity.
    for (let i = 0; i < extractors.length; i++) {
      const extractor = extractors[i]
      await extract.run({ extractor, extracted: entity, pageWorker, main: this })
    }

    // Debug.
    // console.log(`Main - resulting entity object (${entityType}.${bundle}) :`)
    // console.log(entity)
    console.log(`Main - resulting entity object (${entityType}.${bundle}) *content[1]* :`)
    console.log(entity.content[1])
  }
}

module.exports = Main
