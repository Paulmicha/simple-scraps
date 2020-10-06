/**
 * @file
 * DOM-related utilities (specific to Puppeteer).
 */

const minifyHtml = require('html-minifier-terser').minify

/**
 * Determines if given selector matches at least 1 element in the page.
 *
 * See https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pageselector
 */
const exists = async (page, selector, options) => {
  const { timeoutBase, maxRetries, multiplicator } = options
  let result = false
  let timeout = timeoutBase
  let remainingRetries = maxRetries

  if (timeoutBase && remainingRetries) {
    while (!result && remainingRetries) {
      remainingRetries--

      // Debug.
      // console.log(`selector exists ? ${selector}`)
      // console.log(`  timeout = ${timeout}`)
      // console.log(`  remainingRetries = ${remainingRetries}`)

      await page.waitForSelector(selector, { timeout })
        .then(() => { result = true })
        .catch(() => { result = false })
      timeout = timeout * multiplicator
    }
  } else {
    await page.waitForSelector(selector)
      .then(() => { result = true })
      .catch(() => { result = false })
  }

  return result
}

/**
 * Extracts plain text string(s) matching given selector.
 *
 * If multiple elements match the selector, an Array will be returned, otherwise
 * a string.
 */
const text = async (page, selector, removeBreaks) => {
  /* istanbul ignore next */
  const matches = await page.$$eval(selector, items => items.map(
    item => item.textContent
      // The first replace regex is used to remove indentation when HTML
      // markup contains line breaks.
      .replace(/^\s{2,}/gm, '')
      // The second replace regex is used to trim the matched text.
      .replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
  ))

  if (removeBreaks) {
    return arrayOrItemIfSingle(
      matches.map(string => string.replace(/[\r\n]+/gm, ' '))
    )
  }

  return arrayOrItemIfSingle(matches)
}

/**
 * Extracts a single plain text string matching given selector.
 *
 * Unlike the plain text extractor, this always returns a string, no matter how
 * many matches are found. If multiple elements match, the extracted string will
 * join them using given separator (defaults to a space in scraper settings).
 */
const textSingle = async (page, selector, removeBreaks, separator) => {
  const matches = await text(page, selector, removeBreaks)
  if (Array.isArray(matches)) {
    return matches.join(separator)
  }
  return matches
}

/**
 * Extracts inner HTML matching given selector.
 *
 * If multiple elements match the selector, an Array will be returned, otherwise
 * a string.
 */
const markup = async (page, selector, minify) => {
  if (minify) {
    /* istanbul ignore next */
    const matches = await page.$$eval(selector, items => items.map(
      // The replace regex is used to trim the matched markup.
      item => item.innerHTML.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
    ))
    return arrayOrItemIfSingle(
      matches.map(
        html => minifyHtml(html, {
          collapseWhitespace: true,
          // For now, when requested minified, extracted HTML markup is assumed
          // not to preserve inline display impacts of whitespace removal.
          // See http://perfectionkills.com/experimenting-with-html-minifier/#collapse_whitespace
          // conservativeCollapse: true,
          trimCustomFragments: true,
          keepClosingSlash: true
        })
      )
    )
  }
  /* istanbul ignore next */
  return arrayOrItemIfSingle(
    await page.$$eval(selector, items => items.map(
      // The replace regex is used to trim the matched markup.
      item => item.innerHTML.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
    ))
  )
}

/**
 * Extracts DOM elements matching given selector and return the result of
 * given callback.
 *
 * This runs Array.from(document.querySelectorAll(selector)) within the page and
 * passes it as the first argument to callback.
 * See https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pageevalselector-pagefunction-args
 *
 * @returns the return value of callback.
 *
 * @example
 *   const divCount = await dom.select(pageWorker.page, 'div', divs => divs.length)
 */
const select = async (page, selector, callback, ...args) => {
  /* istanbul ignore next */
  return await page.$$eval(selector, callback, ...args)
}

/**
 * Same as select(), but only returns the first match.
 */
const selectFirst = async (page, selector, callback, ...args) => {
  /* istanbul ignore next */
  return await page.$eval(selector, callback, ...args)
}

/**
 * Evaluates given callback in the page context.
 *
 * See https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pageevaluatepagefunction-args
 *
 * If the callback returns a Promise, then this would wait for the promise to
 * resolve and return its value.
 *
 * @returns the return value of callback.
 *
 * @example
 *   // Passing arguments to pageFunction:
 *   const result = await dom.evaluate(pageWorker.page, x => {
 *     return Promise.resolve(8 * x);
 *   }, 7);
 *   console.log(result); // prints "56"
 *
 * @example
 *   // A string can also be passed in instead of a function:
 *   console.log(await dom.evaluate(pageWorker.page, '1 + 2')); // prints "3"
 *   const x = 10;
 *   console.log(await dom.evaluate(pageWorker.page, `1 + ${x}`)); // prints "11"
 *
 * @example
 *   // ElementHandle instances can be passed as arguments to the page.evaluate:
 *   const bodyHandle = await dom.selectFirst(pageWorker.page, 'body');
 *   const html = await dom.evaluate(pageWorker.page, body => body.innerHTML, bodyHandle);
 *   await bodyHandle.dispose();
 */
const evaluate = async (page, evaluated, ...args) => {
  /* istanbul ignore next */
  return await page.evaluate(evaluated, ...args)
}

/**
 * Extracts an attribute from elements matching given selector.
 *
 * Always returns an array.
 */
const attribute = async (page, selector, attribute) => {
  return await select(page, selector, (items, attribute) => items.map(
    item => item.getAttribute(attribute)
  ), attribute)
}

/**
 * Extracts DOM elements matching given selector and return the result of
 * given callback.
 *
 * If multiple elements match the selector, an Array will be returned, otherwise
 * a string.
 */
const element = async (page, selector, callback, ...args) => {
  return arrayOrItemIfSingle(
    await select(page, selector, callback, ...args)
  )
}

/**
 * Adds given CSS class to matching elements.
 *
 * Returns an array of items affected.
 */
const addClass = async (page, selector, CSSClass) => {
  return await select(
    page,
    selector,
    (items, CSSClass) => items.map(item => item.classList.add(CSSClass)),
    CSSClass
  )
}

/**
 * Returns the number of matches for given selector.
 */
const getCount = async (page, selector) => {
  return await page.$$eval(selector, matches => matches.length)
}

/**
 * Returns the first item of an array if it contains only one item, otherwise
 * returns the array.
 */
const arrayOrItemIfSingle = (result) => {
  if (!result || !result.length) {
    return
  }
  if (result.length === 1) {
    return result.pop()
  }
  return result
}

module.exports = {
  exists,
  text,
  textSingle,
  markup,
  attribute,
  element,
  select,
  selectFirst,
  evaluate,
  addClass,
  getCount
}
