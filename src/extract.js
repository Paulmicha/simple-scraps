/**
 * @file
 * Contains extraction implementations.
 */

const urlParse = require('url-parse')

/**
 * Extracts absolute URLs from links matched by given selector.
 */
async function linksUrl (page, selector) {
  // Defaults to look for all <a href="..."> in the page.
  if (!selector) {
    selector = 'a[href]'
  }

  await page.waitForSelector(selector)
  const urlsFound = await page.evaluate((selector) => {
    // This function is running inside headless Chrome.
    const extracts = []
    const anchors = Array.from(document.querySelectorAll(selector))
    anchors.map((anchor) => extracts.push(anchor.href))
    return extracts
  }, selector)

  // Transforms non-absolute URLs into absolute URLS.
  return urlsFound.map(urlFound => {
    if (urlFound.substring(0, 4) !== 'http') {
      const parsedOpUrl = urlParse(page.url())
      return parsedOpUrl.host + urlFound
    }
    return urlFound
  })
}

module.exports = { linksUrl }
