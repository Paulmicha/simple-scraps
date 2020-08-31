/**
 * @file
 * Contains extraction implementations.
 */

const urlParse = require('url-parse')
const Entity = require('./Entity')

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
 * Returns the extrators matching given entity type and bundle.
 */
function get (entity, main) {
  let extractors = []

  Object.keys(main.config)
    .filter(key => key !== 'start')
    .map(key => key.split('/'))
    .filter(keyParts => keyParts[0] === entity.type)
    .map(keyParts => {
      extractors = extractors.concat(main.config[keyParts.join('/')])
    })

  return extractors
}

/**
 * Runs a single extractor on given entity.
 */
async function run (extractor, entity, pageWorker, main) {
  // Each extractor outputs a single field value(s).
  // The 'as' syntax can support any of the following declarations :
  // - <thing>.<prop> (ex: entity.title)
  // - <thing>.<type>.<prop> (ex: component.Lede.text)
  // - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
  const fieldParts = extractor.as.split('.')
  let field = fieldParts[1]
  if (fieldParts.length > 2) {
    field = fieldParts[2]
  }

  // Support multiple props or fields. For convenience, components definitions
  // reuse the entity class.
  if (Array.isArray(extractor.extract)) {
    const component = new Entity(fieldParts[0], fieldParts[1])
    while (extractor.extract.length) {
      const componentExtrator = extractor.extract.shift()
      componentExtrator.selector = `${extractor.selector} ${componentExtrator.selector}`
      await this.run(componentExtrator, component, pageWorker, main)
    }
    entity.setField(field, component)
    return
  }

  // "Normal" process : extractor.extract is a string.
  switch (extractor.extract) {
    case 'text':
      entity.setField(field, await this.text(pageWorker.page, extractor.selector))
      break

    case 'markup':
      entity.setField(field, await this.markup(pageWorker.page, extractor.selector))
      break

    case 'element': {
      if (!extractor.postprocess) {
        throw Error('Missing extractor postprocess for ' + extractor.as + ', selector : ' + extractor.selector)
      }

      // Debug.
      // console.log(`emitting event extract.${extractor.postprocess}`)

      // Emits an event corresponding to the value of extractor.postprocess
      // which gets an object representing the extraction details, and
      // which expects it to be altered to add a callback function in its
      // 'callback' prop.
      // Example function : items => items.map(item => item.innerHTML)
      const postProcessor = {}
      postProcessor.extractor = { ...extractor }
      postProcessor.url = pageWorker.page.url()

      main.emit('extract.' + extractor.postprocess, postProcessor)

      if (!postProcessor.callback) {
        throw Error('Missing callback for element extrator ' + extractor.as + ', selector : ' + extractor.selector)
      }

      entity.setField(field, await this.element(pageWorker.page, extractor.selector, postProcessor.callback))
      break
    }

    case 'components': {
      if (!('components' in main.config)) {
        throw Error('Missing components definition for selector : ' + extractor.selector)
      }

      // For each components extractors defined in conf, recurse inside given
      // selector.
      const components = []

      for (let i = 0; i < main.config.components.length; i++) {
        const subExtractor = main.config.components[i]
        subExtractor.selector = `${extractor.selector} ${subExtractor.selector}`

        const subFieldParts = subExtractor.as.split('.')
        const component = new Entity(subFieldParts[0], subFieldParts[1])

        await this.run(subExtractor, component, pageWorker, main)
        components.push(component)
      }

      entity.setField(field, components)
      break
    }
  }
}

module.exports = {
  linksUrl,
  element,
  markup,
  text,
  get,
  run
}
