/**
 * @file
 * DOM-related utilities (specific to Puppeteer).
 */

const minifyHtml = require('html-minifier-terser').minify

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
 * Extracts an attribute from elements matching given selector.
 *
 * Always returns an array.
 */
const attribute = async (page, selector, attribute) => {
  /* istanbul ignore next */
  return await page.$$eval(selector, items => items.map(
    item => item[attribute]
  ), attribute)
}

/**
 * Extracts DOM elements matching given selector and return the result of
 * given callback.
 *
 * See https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pageevalselector-pagefunction-args
 *
 * If multiple elements match the selector, an Array will be returned, otherwise
 * a string.
 */
const element = async (page, selector, callback) => {
  /* istanbul ignore next */
  return arrayOrItemIfSingle(await page.$$eval(selector, callback))
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
  text,
  textSingle,
  markup,
  attribute,
  element
}
