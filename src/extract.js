/**
 * @file
 * Contains extraction implementations.
 */

const urlParse = require('url-parse')

/**
 * Extracts absolute URLs from links matched by given selector.
 */
async function linksUrl (main, page, url, op) {
  // Defaults to look for all <a href="..."> in the page.
  if (!op.selector) {
    op.selector = 'a[href]'
  }

  await page.waitForSelector(op.selector)
  const urlsFound = await page.evaluate((selector) => {
    // This function is running inside headless Chrome.
    const urlsFound = []
    const anchors = Array.from(document.querySelectorAll(selector))
    anchors.map((anchor) => urlsFound.push(anchor.href))
    return urlsFound
  }, op.selector)

  for (let i = 0; i < urlsFound.length; i++) {
    let urlFound = urlsFound[i]

    // Transforms non-absolute URLs into absolute URLS.
    if (urlFound.substring(0, 4) !== 'http') {
      const parsedOpUrl = urlParse(op.url)
      urlFound = parsedOpUrl.host + urlFound
    }

    // Prevent re-crawling the same URLs.
    if (main.crawledUrls.indexOf(urlFound) !== -1) {
      // Debug ok.
      // console.log("We've already crawled " + urlFound + ' -> skipping')
      continue
    }
    main.crawledUrls.push(urlFound)

    // Handle crawling limits.
    const limitID = op.to + '::' + op.selector
    if (!(limitID in main.crawlLimits)) {
      main.crawlLimits[limitID] = 0
    }
    main.crawlLimits[limitID]++

    if (main.crawlLimits[limitID] > op.maxPagesToCrawl) {
      // Debug ok.
      // console.log("We've reached the crawling limit for " + limitID + ' : ' + main.crawlLimits[limitID])
      continue
    }

    // Debug.
    console.log(main.crawlLimits[limitID] + ' : ' + urlFound + '  :  ' + limitID)

    // Execution depends on the "type" of link.
    if (op.to === 'start') {
      // Recursion (e.g. page links).
      op.conf.url = urlFound
      main.createInitialOps(op.conf)
    } else {
      // Normal extraction.
      op.type = 'extract'
      main.queue.addItem(urlFound, op)
    }
  }
}

module.exports = { linksUrl }
