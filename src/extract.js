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
  return arrayOrItemIfSingle(
    await page.$$eval(selector, items => items.map(item => item.textContent))
  )
}

/**
 * Extracts inner HTML from given selector.
 *
 * If multiple elements match the selector, an Array will be returned, otherwise
 * a string.
 */
async function markup (page, selector) {
  return arrayOrItemIfSingle(
    await page.$$eval(selector, items => items.map(item => item.innerHTML))
  )
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
async function element (page, selector, callback) {
  return arrayOrItemIfSingle(await page.$$eval(selector, callback))
}

/**
 * Returns the first item of an array if it contains only one item.
 */
function arrayOrItemIfSingle (result) {
  if (!result || !result.length) {
    return ''
  }
  if (result.length === 1) {
    return result.pop()
  }
  return result
}

/**
 * Returns the extrators matching given entity type and bundle.
 */
function match (entity, entityType, main) {
  let extractors = []

  Object.keys(main.config)
    .filter(key => key !== 'start')
    .map(key => key.split('/'))
    .filter(keyParts => keyParts[0] === entityType)
    .map(keyParts => {
      extractors = extractors.concat(main.config[keyParts.join('/')])
    })

  return extractors
}

/**
 * Determines what field or prop the given extractor will process.
 *
 * The extract 'as' syntax can support any of the following declarations :
 * - <thing>.<prop> (ex: entity.title)
 * - <thing>.<type>.<prop> (ex: component.Lede.text)
 * - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
 */
function as (extractor, onlyTail) {
  const parts = extractor.as.split('.')

  if (onlyTail) {
    return parts.pop()
  }

  const thing = parts[0]
  const type = parts[1]
  let prop = ''

  if (parts.length > 2) {
    parts.shift()
    parts.shift()
    prop = parts.join('.')
  }

  return [thing, type, prop]
}

/**
 * Runs a single extractor.
 *
 * This is called recursively to allow nested components extraction.
 */
async function run (o) {
  const { extractor, extracted, pageWorker, main, fieldOverride } = o

  // Debug.
  // console.log(o)
  // console.log(
  //   `run() - extract '${extractor.selector}' as ${as(extractor).join(':')}`
  // )

  // By default, the field (or property) that is being extracted is the 2nd part
  // of the "as" key, but it needs to be overridable for nested components.
  // @see as()
  let [, field] = as(extractor)
  if (fieldOverride) {
    field = fieldOverride
  }

  // Support fields containing multiple items with props.
  if (Array.isArray(extractor.extract)) {
    await subItemsFieldProcess({ extractor, extracted, pageWorker, main, field })
    return
  }

  // "Normal" process : extractor.extract is a string.
  switch (extractor.extract) {
    case 'text':
      extracted[field] = await text(pageWorker.page, extractor.selector)
      break
    case 'markup':
      extracted[field] = await markup(pageWorker.page, extractor.selector)
      break
    case 'element':
      await elementFieldProcess({ extractor, extracted, pageWorker, main, field })
      break
    case 'components':
      await componentsFieldProcess({ extractor, extracted, pageWorker, main, field })
      break
  }
}

/**
 * Sub-processes fields containing multiple items with props.
 *
 * Outputs a single object from multiple extractors 'as' for example :
 * - component.MediaGrid.items[].image
 * - component.MediaGrid.items[].title
 * - component.MediaGrid.items[].text
 */
async function subItemsFieldProcess (o) {
  const { extractor, extracted, pageWorker, main, field } = o

  // Debug.
  // console.log(`subItemsFieldProcess(${field})`)
  // console.log(extractor.extract)

  const subItem = {}

  while (extractor.extract.length) {
    const subExtractor = extractor.extract.shift()
    subExtractor.selector = `${extractor.selector} ${subExtractor.selector}`

    const multiFieldItemProp = as(subExtractor, true)

    await run({ extractor: subExtractor, extracted: subItem, pageWorker, main, fieldOverride: multiFieldItemProp })
  }

  // Debug.
  // console.log('  subItem :')
  // console.log(subItem)

  extracted[field] = subItem
}

/**
 * Sub-processes 'element' fields.
 *
 * For these, the extraction process needs to be provided via event handlers.
 *
 * Emits an event corresponding to the value of extractor.postprocess which gets
 * an object representing the extraction details, and which expects it to be
 * altered to add a callback function in its 'callback' prop.
 *
 * Example callback function :
 *  items => items.map(item => item.innerHTML)
 */
async function elementFieldProcess (o) {
  const { extractor, extracted, pageWorker, main, field } = o

  if (!extractor.postprocess) {
    throw Error('Missing extractor postprocess for ' + extractor.as + ', selector : ' + extractor.selector)
  }

  // Debug.
  // console.log(`emitting event extract.${extractor.postprocess}`)

  const postProcessor = {}
  postProcessor.extractor = { ...extractor }
  postProcessor.url = pageWorker.page.url()

  main.emit('extract.' + extractor.postprocess, postProcessor)

  if (!postProcessor.callback) {
    throw Error('Missing callback for element extrator ' + extractor.as + ', selector : ' + extractor.selector)
  }

  // extracted.set(field, await element(pageWorker.page, extractor.selector, postProcessor.callback))
  extracted[field] = await element(pageWorker.page, extractor.selector, postProcessor.callback)
}

/**
 * Sub-processes 'components' fields.
 *
 * For these, the extraction process needs to be provided via event handler.
 */
async function componentsFieldProcess (o) {
  const { extractor, extracted, pageWorker, main, field } = o

  if (!('components' in main.config)) {
    throw Error('Missing components definition for selector : ' + extractor.selector)
  }

  const components = []

  for (let i = 0; i < main.config.components.length; i++) {
    const subExtractor = main.config.components[i]
    subExtractor.selector = `${extractor.selector} ${subExtractor.selector}`

    // const [thing, type, prop] = as(subExtractor)
    const [, type, prop] = as(subExtractor)
    // const component = new Entity(thing, `${type}_${prop}`)
    const component = {}

    await run({ extractor: subExtractor, extracted: component, pageWorker, main, fieldOverride: prop })

    components.push(componentEntityToObject(component, type, prop))
  }

  // extracted.set(field, components)
  extracted[field] = components
}

/**
 * Transforms components extration result to match expected structure.
 *
 * Example extration result (input) :
 *  { Lede: "<p>markup contents</p>" }
 * Expected structure (output) :
 *  { c: "Lede", props: { text: "<p>markup contents</p>" }}
 */
function componentEntityToObject (componentEntity, type, prop) {
  const transformedObject = {}
  transformedObject.c = type
  transformedObject.props = {}

  if (Array.isArray(prop)) {
    prop.forEach(p => {
      transformedObject.props[p] = componentEntity[p]
    })
  } else {
    transformedObject.props[prop] = componentEntity[prop]
  }

  // Debug.
  // console.log(`componentEntityToObject(<componentEntity>, '${type}', '${prop}')`)
  // console.log(componentEntity.get())
  // console.log(transformedObject)

  return transformedObject
}

module.exports = {
  linksUrl,
  element,
  markup,
  text,
  match,
  run
}
