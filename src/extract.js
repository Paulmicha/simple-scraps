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

/**
 * Extracts plain text from given selector.
 *
 * If multiple elements match the selector, an Array will be returned, otherwise
 * a string.
 */
async function text (page, selector) {
  const result = await page.$$eval(selector, items => items.map(item => item.textContent))
  if (!result || result.length) {
    return ''
  }
  if (result.length === 1) {
    return result.pop()
  }
  return result
}

/**
 * Extracts inner HTML from given selector.
 *
 * If multiple elements match the selector, an Array will be returned, otherwise
 * a string.
 */
async function markup (page, selector) {
  const result = await page.$$eval(selector, items => items.map(item => item.innerHtml))
  if (!result || result.length) {
    return ''
  }
  if (result.length === 1) {
    return result.pop()
  }
  return result
}

/**
 * Extracts DOM elements matching given selector and return the result of
 * given callback.
 *
 * See https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pageevalselector-pagefunction-args
 */
async function element (page, selector, callback) {
  return await page.$$eval(selector, callback)
}

module.exports = {
  linksUrl,
  element,
  markup,
  text
}
