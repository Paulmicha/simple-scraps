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
 * Returns the first item of an array if it contains only one item, otherwise
 * returns the array.
 */
function arrayOrItemIfSingle (result) {
  if (!result || !result.length) {
    return
  }
  if (result.length === 1) {
    return result.pop()
  }
  return result
}

/**
 * Returns the extrators matching given entity type.
 */
function match (entityType, main) {
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
 * - <thing>.<prop> (ex: entity.title, component.MediaGrid, etc)
 * - <thing>.<type>.<prop> (ex: component.Lede.text)
 * - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
 */
function as (extractor, onlyTail) {
  const parts = extractor.as.split('.')

  if (onlyTail) {
    return parts.pop()
  }

  return parts
}

/**
 * Runs a single extractor.
 *
 * This is called recursively to allow nested components extraction.
 */
async function run (o) {
  const { extractor, extracted, pageWorker, main, fieldOverride } = o

  // Debug.
  // console.log(Object.keys(o))
  // console.log(extractor)
  console.log(
    `run() - extract '${extractor.selector}' as ${as(extractor).join(':')}`
  )

  // By default, the field (or property) that is being extracted is the 2nd part
  // of the "as" key, but it needs to be overridable for nested components.
  // @see as()
  const destination = as(extractor)
  let field = fieldOverride
  if (!field) {
    field = destination[1]
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
 *
 * When the destination contains the string '[]', it means that we need to
 * create an array of objects. Each object can have 1 or many fields (or props).
 * Ex : component.MediaGrid.items[].title
 *  -> the component has an "items" property to be extracted as an array of
 *  objects, whose "title" is processed by a single sub-extractor run separately.
 *
 * When a field has a single match, its value is a string and is considered to
 * belong to the 1st item. Hence, we need to delimit the scope of a single item
 * otherwise if all fields do not have the same number of matches, we couldn't
 * determine to which item the extracted values belong.
 * -> Solution :
 * The 'delimiter' config is a CSS selector that sets the scope of every
 * single child item. Any element matched outside of this selector does not
 * belong to the same item.
 */
async function subItemsFieldProcess (o) {
  const { extractor, extracted, pageWorker, main, field } = o

  // Debug.
  console.log(`subItemsFieldProcess(${field})`)
  // console.log(extractor.extract)

  const subItem = {}
  const subItemDelimiters = []

  while (extractor.extract.length) {
    const componentExtractor = extractor.extract.shift()
    componentExtractor.selector = `${extractor.selector} ${componentExtractor.selector}`

    const multiFieldItemProp = as(componentExtractor, true)

    // Delimiters use "markers" that are directly set on the DOM element defined
    // as scope for every single child item.
    // It's a data-attribute containing a counter.
    const destination = as(componentExtractor)
    if (destination[2].indexOf('[]') !== false) {
      // TODO (wip)
      subItemDelimiters.push(destination[2])
    }

    await run({
      extractor: componentExtractor,
      extracted: subItem,
      pageWorker,
      main,
      fieldOverride: multiFieldItemProp
    })
  }

  // Debug.
  console.log(`  TODO (wip) implement delimiters for ${subItemDelimiters.join(', ')}`)

  // Debug.
  // console.log('  subItem :')
  // console.log(subItem)

  // At this point, the subItem object has the following structure :
  //  { <field_1>: 'value 1', <field_2>: ['value 2.1', 'value 2.2'] }
  // What we need is the following :
  //  [
  //    { <field_1>: 'value 1', <field_2>: 'value 2.1' },
  //    { <field_2>: 'value 2.2' }
  //  ]
  const subItems = []
  Object.keys(subItem).forEach(key => {
    if (Array.isArray(subItem[key])) {
      subItem[key].forEach((value, i) => {
        if (!subItems[i]) {
          subItems[i] = {}
        }
        subItems[i][key] = value
      })
    } else {
      if (!subItems[0]) {
        subItems[0] = {}
      }
      subItems[0][key] = subItem[key]
    }
  })

  // Debug.
  // console.log('  subItems :')
  // console.log(subItems)

  extracted[field] = subItems
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

  extracted[field] = await element(pageWorker.page, extractor.selector, postProcessor.callback)
}

/**
 * Sub-processes 'components' fields.
 *
 * Some component extractors have a single prop destination, e.g. :
 *  "as": "component.Lede.text"
 * In this case, the resulting object is completed in a single run.
 *
 * Other components may define multiple extractors to complete their object. In
 * this case, the "extract" key would contain an array (of extractors), and the
 * destination would be e.g. :
 *  "as": "component.MediaGrid"
 */
async function componentsFieldProcess (o) {
  const { extractor, extracted, pageWorker, main, field } = o

  if (!('components' in main.config)) {
    throw Error('Missing components definition for selector : ' + extractor.selector)
  }

  const components = []

  for (let i = 0; i < main.config.components.length; i++) {
    const componentExtractor = main.config.components[i]
    componentExtractor.selector = `${extractor.selector} ${componentExtractor.selector}`

    const component = {}
    const [thing, type, prop] = as(componentExtractor)

    // For components having a single prop to extract, e.g. :
    //  "as": "component.Lede.text"
    // we can handle these in a single run.
    // Otherwise, the "extract" key contains an array of sub-extractors which
    // must all run on the same component object.
    if (!Array.isArray(componentExtractor.extract)) {
      await run({
        extractor: componentExtractor,
        extracted: component,
        pageWorker,
        main,
        fieldOverride: prop
      })
      components.push(componentEntityToObject(component, type, prop))
    } else {
      // We need to regroup sub-extractors to differenciate fields containing
      // multiple values (each value requiring its own extractor run) from
      // simpler ones (that can be dealt with in a single run).
      const regroupedExtractors = {}

      while (componentExtractor.extract.length) {
        const subExtractor = componentExtractor.extract.shift()
        const destination = as(subExtractor)
        let groupBy = destination[2]

        if (destination[2].indexOf('[]') !== false) {
          groupBy = destination[2].replace('[]', '')
        }
        if (!(groupBy in regroupedExtractors)) {
          regroupedExtractors[groupBy] = []
        }

        regroupedExtractors[groupBy].push(subExtractor)
      }

      // For example, at this stage, we would have something like :
      //  regroupedExtractors = {
      //    items: [
      //      { as : 'component.MediaGrid.items[].image', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].title', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].text', ... <rest of extractor definition> }
      //    ],
      //    variant: [
      //      { as : 'component.MediaGrid.variant', ... <rest of extractor definition> }
      //    ]
      //  }

      // So now, we need to generate 1 extractor definition per prop to match
      // what is expected in the run() function :
      //
      //  subExtractorForItemsProp = {
      //    selector: <Here we use the CSS selector of the scope delimiter
      //      from the grouped extractors of the sub-item if available, else
      //      we take the one from the component which then acts as the
      //      fallback scope>,
      //    extract: [
      //      { as : 'component.MediaGrid.items[].image', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].title', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].text', ... <rest of extractor definition> }
      //    ],
      //    as: 'component.MediaGrid.items',
      //    ... <any other keys, e.g. 'postprocess'>
      //  }
      //
      //  subExtractorForVariantProp = {
      //    selector: <idem>,
      //    extract: <use the value from 'variant' prop extractor definition>,
      //    as : 'component.MediaGrid.variant',
      //    ... <any other keys, e.g. 'postprocess'>
      //  }
      const fields = Object.keys(regroupedExtractors)

      // Debug.
      console.log('fields :')
      console.log(fields)

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]
        const subExtractors = regroupedExtractors[field]
        const newExtractor = {}

        // TODO (wip)
        newExtractor.as = `${thing}.${type}.${field}`

        // Selector fallback : use the component's extractor value. Then look
        // for a 'delimiter' key in child extractor(s) definition(s) if
        // available.
        newExtractor.selector = componentExtractor.selector
        subExtractors.forEach(ex => {
          if ('delimiter' in ex) {
            newExtractor.selector = ex.delimiter
          }
        })

        // Debug.
        console.log('newExtractor :')
        console.log(newExtractor)
        // console.log('extractors :')
        // console.log(regroupedExtractors[field].map(e => e.as))

        // await run({
        //   extractor: regroupedExtractors[field],
        //   extracted: component,
        //   pageWorker,
        //   main,
        //   fieldOverride: field
        // })
      }

      // Debug.
      console.log('component :')
      console.log(component)

      components.push(componentEntityToObject(component, type, fields))
    }
  }

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
