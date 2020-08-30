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
  if (!result || !result.length) {
    return ''
  }

  // TODO make values trimming optional ?
  result.map(str => str.trim())

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
  const result = await page.$$eval(selector, items => items.map(item => item.innerHTML))
  if (!result || !result.length) {
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

/**
 * Runs a single extractor on given entity.
 */
async function run (extractor, entity, pageWorker, main) {
  // Each extractor should output a single field value(s).
  // TODO remove "namespaced" 'as' definitions (i.e. entity.<field>) ?
  const fieldParts = extractor.as.split('.')
  const field = fieldParts[1]

  // TODO [wip] a single component must support multiple props. WIP.
  if (Array.isArray(extractor.extract)) {
    return
  }

  switch (extractor.extract) {
    case 'text':
      entity.setField(field, await this.text(pageWorker.page, extractor.selector))
      break

    case 'markup':
      entity.setField(field, await this.markup(pageWorker.page, extractor.selector))
      break

    case 'element': {
      if (!extractor.postprocess) {
        throw Error('Error : missing extractor postprocess for ' + extractor.as + ', selector : ' + extractor.selector)
      }

      // Emits an event corresponding to the value of extractor.postprocess
      // which gets an object representing the extraction details, and
      // which expects it to be altered to add a callback function in its
      // 'callback' prop.
      const postProcessor = {}
      postProcessor.extractor = { ...extractor }
      postProcessor.url = pageWorker.page.url()

      // Debug.
      console.log(`emitting event ${extractor.postprocess}`)

      main.emit(extractor.postprocess, postProcessor)

      if (!postProcessor.callback) {
        throw Error('Error : missing callback for element extrator ' + extractor.as + ', selector : ' + extractor.selector)
      }

      entity.setField(field, await this.element(pageWorker.page, extractor.selector, postProcessor.callback))
      break
    }

    case 'components':
      if (!('components' in main.config)) {
        throw Error('Error : missing components definition for selector : ' + extractor.selector)
      }
      // For each components extractors defined in conf, recurse inside given
      // selector.
      for (let i = 0; i < main.config.components.length; i++) {
        const subExtractor = main.config.components[i]
        subExtractor.selector = `${extractor.selector} ${subExtractor.selector}`
        entity.setField(field, await this.run(subExtractor, entity, pageWorker))
      }
      break
  }
}

module.exports = {
  linksUrl,
  element,
  markup,
  text,
  run
}
