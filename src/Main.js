const EventEmitter = require('events')
const puppeteer = require('puppeteer')
const Page = require('./Page')
const Queue = require('./Queue')
const Entity = require('./Entity')
const extract = require('./extract')
const cache = require('./cache')
const fs = require('fs')

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
   * Creates initial operations (adds new pages to crawl).
   */
  async createInitialOps (entryPoint) {
    for (let j = 0; j < entryPoint.follow.length; j++) {
      const op = entryPoint.follow[j]

      this.operations.addItem(entryPoint.url, {
        type: 'follow',
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
        case 'follow':
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
   * TODO [wip] extraction process starting point.
   */
  async extract (pageWorker, op) {
    // Debug.
    // console.log('extraction TODO for url = ' + pageWorker.page.url())
    // console.log('  (from ' + op.conf.url + ')')
    // console.log(op)

    if (!('to' in op)) {
      throw Error('Error : missing extraction destination (to)')
    }

    // First, get all defined extractors that match current destination.
    const destination = op.to.split('/')
    const main = this
    let extractors = []
    Object.keys(this.config)
      .filter(key => key !== 'start')
      .map(key => key.split('/'))
      .filter(keyParts => keyParts[0] === destination[0])
      .map(keyParts => {
        extractors = extractors.concat(main.config[keyParts.join('/')])
      })

    // Debug.
    // console.log(extractors)

    // Then prepare the entity that will be extracted (each extractor deals with
    // a part of the same entity).
    const entity = new Entity(destination[0], destination[1])

    // Chain all extractors that need to run on given page to build our entity.
    for (let i = 0; i < extractors.length; i++) {
      const extractor = extractors[i]
      await extract.run(extractor, entity, pageWorker, this)
    }

    // Debug.
    console.log('end result = ')
    console.log(entity.export())
  }
}

module.exports = Main
