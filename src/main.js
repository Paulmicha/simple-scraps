const puppeteer = require('puppeteer')
const urlParse = require('url-parse')
const Queue = require('./queue')
const cashPath = require.resolve('cash-dom')
const debug = require('debug')
const debugConsole = debug('simple-scraps:console')
// const debugDialog = debug('simple-scraps:dialog')

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
   * Instanciates Puppeteer and the operation queue.
   */
  async init () {
    this.queue = new Queue()
    this.browser = await puppeteer.launch()
    this.page = await this.browser.newPage()
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
    // const page = await this.open(url)
    // await this.execOps(url, page)
    await this.open(url)
    await this.execOps(url)
    // TODO [wip] why does this get it closed too soon ?
    // page.close()
  }

  /**
   * Opens a new Puppeteer page and loads given URL.
   */
  async open (url) {
    // const page = await this.browser.newPage()
    await this.page.setViewport({ width: 1280, height: 800 })

    this.page.on('pageerror', text => debugConsole(text))
    this.page.on('console', msg => console.log(`${msg.type()} ${msg.text()} at ${url}`))
    this.page.on('dialog', dialog => this.handleDialog(dialog, url))

    // Debug.
    this.page.on('close', () => console.log('page is closed'))

    await this.page.goto(url)

    // Utility helper to help DOM querying / manipulation.
    // If jQuery is already loaded, make sure it's available in global scope as
    // the $() function. Otherwise, include the 'cash-dom' lib.
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

    // return page
  }

  /**
   * Executes all operations queued for given URL.
   */
  // async execOps (url, page) {
  async execOps (url) {
    while (this.queue.getItemsCount(url)) {
      const op = this.queue.getItem(url)
      if (!op) {
        return
      }

      // Debug
      // console.log('Executing ' + url + " 'op' :")
      // console.log(op)

      // Merge context data with operation object representation for convenience.
      // op.url = url
      // op.page = page

      switch (op.type) {
        case 'follow':
          // await this.findLinks(url, page, op)
          await this.findLinks(url, op)
          break
      }
    }
  }

  async stop () {
    await this.browser.close()
  }

  async getContent () {
    return await this.page.content()
  }

  // async findLinks (url, page, op) {
  async findLinks (url, op) {
    // Defaults to look for all <a href="..."> in the page.
    if (!op.selector) {
      op.selector = 'a[href]'
    }

    // Failed debug (can't pass page as argument, had to use this.page)
    // await op.page.evaluate(() => console.log('test'))

    // Debug ok :
    await this.page.evaluate(() => console.log('test'))

    console.log(op)
    await this.page.evaluate((selector) => console.log('test selector passed = ' + selector), op.selector)

    // Fails :
    // await this.page.waitForSelector(op.selector)

    const urlsFound = await this.page.evaluate((selector) => {
      // This function is running inside headless Chrome.
      const urlsFound = []
      const anchors = Array.from(document.querySelectorAll(selector))
      anchors.map((anchor) => urlsFound.push(anchor.href))
      return urlsFound
    }, op.selector)

    for (let i = 0; i < urlsFound.length; i++) {
      let urlFound = urlsFound[i]

      console.log('urlFound = ' + urlFound)

      // Transforms non-absolute URLs into absolute URLS.
      if (urlFound.substring(0, 4) !== 'http') {
        const parsedOpUrl = urlParse(op.url)
        urlFound = parsedOpUrl.host + urlFound
      }

      console.log('urlFound = ' + urlFound + ' (after)')

      // Recursion (e.g. page links)
      // if (op.to === 'start') {
      //   op.conf.url = urlFound
      //   this.createInitialOps(op.conf)
      // } else {
      //   op.type = 'extract'
      //   this.queue.addItem(urlFound, op)
      // }
    }
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

module.exports = Main
