const EventEmitter = require('events')
const puppeteer = require('puppeteer')
const Page = require('./Page')
const Queue = require('./Queue')
const Extractor = require('./Extractor')
const cache = require('./cache')
const output = require('./output')
const defaultConfig = require('./utils/default_config')
const dom = require('./utils/dom')

/**
 * Main "simple scraps" class.
 *
 * Overview :
 * - queue : contains all operations that should run before the entire process
 *  comes to an end.
 * - crawl : opens given URL and queues new operation(s) (crawl or extract).
 * - extract : outputs structured data according to rules declared in config.
 *
 * @emits pre-queue.operation.extract ({string} urlFound, {object} op)
 *  Allows to skip extracting given URL.
 * @emits alter.extraction.result ({object} entity, {string} entityType, {string} bundle, {Page} pageWorker)
 *  Allows to modify an extracted object before storage.
 * @emits store.extraction.result ({object} entity, {string} entityType, {string} bundle, {string} url, {Page} pageWorker)
 *  Allows to provide alternative storage method for extracted objects.
 * @emits store.page.markup ({string} content, {string} url, {Page} pageWorker)
 *  Allows to provide alternative cache storage method for pages HTML markup.
 * @emits store.page.screenshot ({string} url, {Page} pageWorker)
 *  Allows to provide alternative cache storage method for pages screenshots.
 */
class Main extends EventEmitter {
  /**
   * @param {object|array} config if an array is passed, assume items are entry
   *  points.
   */
  constructor (config) {
    super()

    if (Array.isArray(config)) {
      config = { start: config }
    }

    this.config = config
    this.pages = []
    this.openPages = {}
    this.pagesAllocationCursor = 0
    this.operations = new Queue()
    this.crawledUrls = []
    this.crawlLimits = {}

    if (!('settings' in this.config)) {
      this.config.settings = {}
    }
  }

  /**
   * General config getter.
   *
   * Also provides default settings.
   * @see src/utils/default_config.js
   */
  getSetting (setting) {
    if (!(setting in this.config.settings)) {
      return defaultConfig.setting(setting)
    }
    return this.config.settings[setting]
  }

  /**
   * General configs getter.
   */
  getSettings () {
    return this.config.settings
  }

  /**
   * General config setter.
   */
  setSetting (setting, value) {
    this.config.settings[setting] = value
  }

  /**
   * General configs setter.
   */
  setSettings (settings) {
    Object.keys(settings).forEach(key => this.setSetting(key, settings[key]))
  }

  /**
   * Instanciates the headless browser with 1 page per maxParallelPages setting.
   */
  async init () {
    this.browser = await puppeteer.launch()
    const promises = []
    for (let i = 0; i < this.getSetting('maxParallelPages'); i++) {
      const pageWorker = new Page(this)
      this.pages.push(pageWorker)
      promises.push(pageWorker.init())
    }
    await Promise.all(promises)
  }

  /**
   * Populates the queue with initial operations and starts the main loop.
   *
   * Operations are processed in batch of up to 'maxParallelPages' pages (1 page
   * per URL).
   *
   * Each entry point defines an URL where either links are followed (starts a
   * spider crawling process), or some output is extracted directly.
   *
   * @example
   *  // This entry point only extracts a single string :
   *  {
   *    url: 'https://domain.com/my-page-to-extract',
   *    extract: [
   *      {
   *        selector: 'head title',
   *        extract: 'text',
   *        as: 'entity.title'
   *      }
   *    ]
   *  }
   *
   * @example
   *  // This entry point starts a link crawling process, where pager links will
   *  // trigger a recursive crawling process, and all links found in articles
   *  // title headings will trigger the extraction of 'blog' content entities :
   *  {
   *    "url": "https://www.chouette.net.br/blog",
   *    "follow": [
   *      {
   *        "selector": ".view-chouette-articles article h2 > a",
   *        "to": "content/blog",
   *        "cache": true,
   *        "maxPagesToCrawl": 15
   *      },
   *      {
   *        "selector": ".view-chouette-articles .c-pagination a",
   *        "to": "start",
   *        "maxPagesToCrawl": 3
   *      }
   *    ]
   *  }
   */
  async start () {
    const entryPoints = this.config.start
    if (!entryPoints) {
      throw Error('Missing start config (no entry points were found)')
    }

    // Begins with populating the initial URL(s) operation(s).
    for (let i = 0; i < entryPoints.length; i++) {
      const entryPoint = entryPoints[i]
      if (!entryPoint.url) {
        throw Error('Missing start url')
      }
      // This can be used as a spider (opens an initial page where there are
      // links to follow) or to extract directly data from a single URL.
      if (!entryPoint.follow) {
        if (!entryPoint.extract) {
          throw Error('Missing start links to follow')
        }
        // Assume the URL being extracted is a 'page' (content) entity when not
        // explicitly defined in entry point.
        if (!entryPoint.is) {
          entryPoint.is = 'content/page'
        }
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

  /**
   * When the crawling is over, this method closes everything that was open (the
   * pages and the browser itself).
   */
  async stop () {
    const promises = []
    this.pages.forEach(pageWorker => {
      promises.push(pageWorker.page.close())
    })
    await Promise.all(promises)
    await this.browser.close()
  }

  /**
   * Wraps the 3 steps that constitues the entire lifecycle of a scraping
   * session.
   */
  async run () {
    await this.init()
    await this.start()
    await this.stop()
  }

  /**
   * Creates initial operations (adds new pages to crawl or directly extract).
   */
  async createInitialOps (entryPoint) {
    if (!entryPoint.follow) {
      const op = {
        type: 'extract',
        to: entryPoint.is,
        extract: entryPoint.extract,
        cache: entryPoint.cache,
        conf: { ...entryPoint }
      }
      this.emit('pre-queue.operation.extract', entryPoint.url, op)
      if (!op.skip) {
        this.operations.addItem(entryPoint.url, op)
      }
      return
    }

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
    const urlsFound = await dom.attribute(pageWorker.page, op.selector, 'href')
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
      if (op.to === 'follow') {
        // Recursion (e.g. pager links).
        // NB. createInitialOps() will set op.type = 'crawl'.
        op.conf.url = urlFound
        this.createInitialOps(op.conf)
      } else {
        // Normal extraction.
        op.type = 'extract'
        // Allow to skip this operation via event.
        this.emit('pre-queue.operation.extract', urlFound, op)
        if (!op.skip) {
          this.operations.addItem(urlFound, op)
        }
      }
    }
  }

  /**
   * Caching process (optional).
   */
  async cache (pageWorker, op) {
    await cache.savePageMarkup(pageWorker, this)
    if (this.getSetting('cacheWithScreenshot')) {
      await cache.screenshot(pageWorker, this)
    }
  }

  /**
   * Extraction process starting point.
   *
   * Deals with cases where the conf contains 1 or more entry points with no
   * mapping to extractors, but provide their own extractors directly.
   */
  async extract (pageWorker, op) {
    if (!('to' in op)) {
      throw Error('Missing extraction destination (to)')
    }

    const extractor = new Extractor(op, pageWorker, this)
    const entity = await extractor.run()

    // Allow alterations before saving.
    this.emit('alter.extraction.result', entity, extractor)

    // Debug.
    // console.log(`Main - resulting entity object (${extractor.entityType}.${extractor.bundle}) :`)
    // console.log(entity)
    // console.log(`Main - resulting entity object (${entityType}.${bundle}) *content[1].props* :`)
    // console.log(entity.content[1].props)

    await output.saveExtractionResult(entity, extractor)
  }
}

module.exports = Main
