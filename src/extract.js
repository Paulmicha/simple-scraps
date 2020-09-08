/**
 * @file
 * Contains extraction implementations.
 */

const urlParse = require('url-parse')
const minifyHtml = require('html-minifier-terser').minify
const { compare } = require('specificity')

/**
 * Extracts absolute URLs from links matched by given selector.
 */
const linksUrl = async (page, selector) => {
  // Defaults to look for all <a href="..."> in the page.
  if (!selector) {
    selector = 'a[href]'
  }

  await page.waitForSelector(selector)
  /* istanbul ignore next */
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
const textSingle = async (page, selector, separator, removeBreaks) => {
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

/**
 * Returns the extrators matching given entity type.
 */
const match = (entityType, main) => {
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
const as = (extractor, onlyTail) => {
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
const run = async (o) => {
  const { extractor, extracted, pageWorker, main, fieldOverride } = o

  // Preprocess selectors to handle scope in recusrive calls and customizations.
  // Also imposes a depth limit for nested extraction process to avoid infinite
  // recursions for components including components.
  // @see preprocessExtractor()
  const carryOn = preprocessExtractor(o)
  if (!carryOn) {
    return
  }

  // Debug.
  // console.log(Object.keys(o))
  // console.log(extractor)
  // console.log(
  //   `run() - extract '${extractor.selector}' as ${as(extractor).join(':')}`
  // )

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
      extracted[field] = await text(
        pageWorker.page,
        extractor.selector,
        main.getSetting('plainTextRemoveBreaks')
      )
      break
    case 'text_single':
      extracted[field] = await textSingle(
        pageWorker.page,
        extractor.selector,
        main.getSetting('plainTextSeparator'),
        main.getSetting('plainTextRemoveBreaks')
      )
      break
    case 'markup':
      extracted[field] = await markup(
        pageWorker.page,
        extractor.selector,
        main.getSetting('minifyExtractedHtml')
      )
      break
    // TODO implement an extraction for attribute(s).
    case 'element':
      await elementFieldProcess({ extractor, extracted, pageWorker, main, field })
      break
    // In order to support nested components extraction, we need to start from
    // the "deepest" nesting levels to avoid matching the same elements multiple
    // times. This is achieved by storing 'components' fields aside for later
    // processing during a second extraction pass, where we'll be able to scope
    // extraction and mark extracted components to avoid potential duplicates.
    // @see runrunSecondPass()
    case 'components': {
      await componentsFieldProcess({ extractor, extracted, pageWorker, main, field })

      // TODO other refactor in progress.
      /*
      // This placeholder sits in the exact place in the extracted object where
      // components will be looked for and merged during the second pass.
      const componentsFieldPlaceholder = {}
      extracted[field] = componentsFieldPlaceholder

      // Store references to placeholder objects in a single property directly
      // on the page worker instance for easier processing later on.
      // @see runSecondPass()
      pageWorker.extractionPlaceholders.push({
        placeholder: componentsFieldPlaceholder,
        context: o
      })

      // We still need to look ahead for "seeding" components nesting other
      // components.
      // TODO (wip)
      */
      break
    }
  }
}

/**
 * Preprocessor allowing components nesting, scope, and custom selectors.
 *
 * This facilitates scope handling, allows customizations and jQuery-like
 * selector syntax if there is a DOM Query Helper available in browsed page(s).
 * @see Page.addDomQueryHelper()
 *
 * If the extractor has a 'preprocess' key, its value serves as the event
 * emitted to allow custom implementations that would prepare elements (e.g. add
 * custom classes) to facilitate the extraction process.
 *
 * Examples of jQuery-like syntax :
 *   1. Set a custom class on parent element and use it as new scope :
 *     "selector": ".nav-tabs.parent()"
 *   2. Idem, but using closest() to set scope in any ancestor (stops at closest
 *    match) :
 *     "selector": ".nav-tabs.closest(section)"
 *   3. Going up then down the DOM tree :
 *     "selector": ".nav-tabs.closest(section).find(.something)"
 *
 * TODO evaluate alternative to provide an array of selectors to deal with cases
 * where we need to build a single component out of multiple elements that do
 * not share a "not too distant" common ancestor.
 *
 * @returns {boolean} carry on or stops the recursive extraction process.
 */
const preprocessExtractor = (o) => {
  const { extractor, main, parentExtractor } = o

  // Assign an "ancestor chain" string to the extractor. It will we used for
  // easier processing during the second pass for nested components extraction.
  // @see run()
  let ancestors = []
  let ancestorsChain = ''

  if (parentExtractor) {
    extractor.parent = parentExtractor
    ancestors = getExtractorAncestors(extractor)
    ancestorsChain = ancestors.map(e => e.as).join(' <- ') + ' <- '

    // Also assign a scope for current extractor, and prepend selector for
    // ensuring correct nesting during recusrive calls.
    extractor.scope = parentExtractor.selector
    extractor.selector = `${parentExtractor.selector} ${extractor.selector}`
  }

  extractor.depth = ancestors.length
  extractor.ancestors = ancestors
  extractor.ancestorsChain = ancestorsChain + extractor.as

  // Impose a depth limit, otherwise there would be inevitable infinite loops
  // when components include other components.
  if (extractor.depth > main.getSetting('maxExtractionNestingDepth')) {
    return false
  }

  // Call any custom 'preprocess' implementations.
  if ('preprocess' in extractor) {
    main.emit(extractor.preprocess, o)
  }

  // Debug.
  const debugIndent = '  '.repeat(extractor.depth)
  console.log(`${debugIndent}depth ${extractor.depth} : ${extractor.ancestorsChain}`)
  console.log(`${debugIndent}  ( ${extractor.selector} )`)

  // TODO [wip] next iteration :
  // Detect + convert jQuery-like syntax to normal CSS selectors (injects custom
  // classes).
  // if (main.getSetting('addDomQueryHelper')) {
  // }

  return true
}

/**
 * Returns an array of extractors that represents the "nesting chain".
 *
 * @param {object} extractor
 */
const getExtractorAncestors = (extractor) => {
  const ancestors = []
  while (extractor.parent) {
    ancestors.push(extractor.parent)
    extractor = extractor.parent
  }
  return ancestors.reverse()
}

/**
 * Sub-processes fields containing multiple items with props.
 *
 * Outputs a single object from multiple extractors 'as' for example :
 * - component.MediaGrid.items[].image
 * - component.MediaGrid.items[].title
 * - component.MediaGrid.items[].text
 *
 * For now, there is NO support for deeper levels - e.g. :
 * - component.MediaGrid.items[].nested[].value
 * In these situations, nested child components are expected instead - e.g. :
 *   {
 *     "selector": "header + section > .bs-component",
 *     "extract": [
 *       {
 *         "selector": "> .nav-tabs > li > .nav-link",
 *         "extract": "text",
 *         "as": "component.NavTabs.items[].title"
 *       },
 *       {
 *         "selector": "> .tab-content > .tab-pane",
 *         "extract": "components",
 *         "as": "component.MediaGrid.items[].content"
 *       }
 *     ],
 *     "as": "component.NavTabs"
 *   }
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
const subItemsFieldProcess = async (o) => {
  const { extractor, extracted, pageWorker, main, field } = o

  // Debug.
  // console.log(`subItemsFieldProcess(${field})`)
  // console.log(extractor.extract)

  const subItem = {}
  const subItemDelimiters = []

  while (extractor.extract.length) {
    const componentExtractor = extractor.extract.shift()
    // componentExtractor.selector = `${extractor.selector} ${componentExtractor.selector}`

    const multiFieldItemProp = as(componentExtractor, true)

    // Delimiters use "markers" that are directly set on the DOM element defined
    // as scope for every single child item. They are data-attributes containing
    // a counter.
    const destination = as(componentExtractor)

    // TODO (wip) this will be implemented when we write tests.
    // const destArrCursors = []
    // destination.forEach((fragment, i) => {
    //   if (fragment.indexOf('[]') !== false) {
    //     destArrCursors.push(i)
    //   }
    // })

    // Debug.
    subItemDelimiters.push(destination.join('.'))

    await run({
      extractor: componentExtractor,
      parentExtractor: extractor,
      extracted: subItem,
      pageWorker,
      main,
      fieldOverride: multiFieldItemProp
    })
  }

  // Debug.
  // console.log(`  TODO (wip) implement delimiters for ${subItemDelimiters.join(', ')}`)

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
 * Emits an event corresponding to the value of extractor.emit which gets
 * an object representing the extraction details, and which expects it to be
 * altered to add a callback function in its 'callback' prop.
 *
 * Example callback function :
 *  items => items.map(item => item.innerHTML)
 */
const elementFieldProcess = async (o) => {
  const { extractor, extracted, pageWorker, main, field } = o

  if (!extractor.emit) {
    throw Error('Missing extractor "emit" config for processing ' + extractor.as + ', selector : ' + extractor.selector)
  }

  // Debug.
  // console.log(`emitting event '${extractor.emit}'`)

  // The event listeners may provide either :
  //  - a callback function which will be used by puppeteer's page.$$eval() API
  //  - the field value directly (takes precedence if set)
  main.emit(extractor.emit, o)

  if ('result' in o) {
    extracted[field] = o.result
    return
  }

  if (!o.callback) {
    throw Error('Missing callback for processing ' + extractor.as + ', selector : ' + extractor.selector)
  }
  extracted[field] = await element(pageWorker.page, extractor.selector, o.callback)
}

/**
 * Runs a second extraction pass for nested components support.
 *
 * To avoid component nesting problem (e.g. ".card" inside another component
 * -> potential multiple matches from root to deepest nesting levels), we needed
 * a way to start by extracting the deepest levels first and mark the components
 * as extracted.
 *
 * This makes use of a property on the page worker instance itself which stores
 * all 'components' fields placeholder objects (which are built recursively from
 * config) in order to handle the processing in the correct order during this
 * second "pass".
 *
 * Nesting depth detection uses extractors' ancestors count, and in case of
 * equality, we compare CSS selectors specificity - after custom jQuery-like
 * syntax was converted by preprocessExtractor().
 *
 * See https://github.com/keeganstreet/specificity
 */
const runSecondPass = async (o) => {
  const { extracted, pageWorker, main } = o

  // Debug.
  console.log('')
  console.log('second pass - pageWorker.extractionPlaceholders')
  console.log(pageWorker.extractionPlaceholders.map(p => p.context.extractor.ancestorsChain))

  // Nothing to do if no components fields were set in config.
  if (!pageWorker.extractionPlaceholders.length) {
    return
  }

  // No need to compare anything if there's only a single components field.
  if (pageWorker.extractionPlaceholders.length === 1) {
    const extractionPlaceholder = pageWorker.extractionPlaceholders.pop()
    await componentsFieldProcess(extractionPlaceholder.context)

    // debug
    extractionPlaceholder.placeholder.test_field = 'test value'

    return
  }

  // Sort placeholders by most deeply nested then CSS selectors specificity.
  pageWorker.extractionPlaceholders.sort((a, b) => {
    // 'a' is less specific than 'b' (= less deeply nested).
    if (a.context.extractor.depth < b.context.extractor.depth) {
      return -1
    }
    // 'a' is more specific than 'b' (= nested deeper).
    if (a.context.extractor.depth > b.context.extractor.depth) {
      return 1
    }
    // Equality leads to CSS selectors specificity comparison.
    if (a.context.extractor.depth === b.context.extractor.depth) {
      return compare(a.context.extractor.selector, b.context.extractor.selector)
    }
  })

  // TODO (wip)
  console.log('runSecondPass() - sorting result :')
  console.log(pageWorker.extractionPlaceholders)
  // console.log(extracted)
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
const componentsFieldProcess = async (o) => {
  const { extractor, extracted, pageWorker, main, field } = o

  // Debug.
  console.log('componentsFieldProcess()')

  // Prevent infinite loops during nested components lookup.
  // @see preprocessExtractor()
  if (extractor.ancestorsChain.length) {
    if (pageWorker.componentsExtracted.includes(extractor.ancestorsChain)) {
      // Debug.
      console.log(`  abort due to already processed ${extractor.ancestorsChain}`)
      return
    }
    pageWorker.componentsExtracted.push(extractor.ancestorsChain)
  }

  // if (extractor.stopRecursiveLookup) {
  //   return
  // }
  // Prevent infinite loops by checking this extractor hasn't run already in
  // given scope.
  // if (extractor.ancestors && extractor.ancestors.includes(parentExtractor)) {
  //   extractor.stopRecursiveLookup = true
  //   return
  // }

  // TODO evaluate wildcards for doing things like :
  //  "extract": "components.nested"
  // which could contain e.g. only selector overrides based on the "base"
  // extractors (components).
  if (!('components' in main.config)) {
    throw Error('Missing components definition for selector : ' + extractor.selector)
  }

  const components = []

  for (let i = 0; i < main.config.components.length; i++) {
    const componentExtractor = { ...main.config.components[i] }
    const component = {}
    const [thing, type, prop] = as(componentExtractor)

    // Debug.
    console.log(componentExtractor.as)

    // For components having a single prop to extract, e.g. :
    //  "as": "component.Lede.text"
    // we can handle these in a single run.
    // Otherwise, the "extract" key contains an array of sub-extractors which
    // must all run on the same component object.
    if (!Array.isArray(componentExtractor.extract)) {
      // Debug.
      console.log('  Single extractor component definition')

      await run({
        extractor: componentExtractor,
        parentExtractor: extractor,
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

      // while (componentExtractor.extract.length) {
      //   const subExtractor = componentExtractor.extract.shift()
      for (let j = 0; j < componentExtractor.extract.length; j++) {
        const subExtractor = componentExtractor.extract[j]
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
      //
      // So now, we need to generate 1 extractor definition per prop to match
      // what is expected in the run() function :
      //
      //  -> For multi-props sub items :
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
      //    as: 'component.MediaGrid.items'
      //  }
      //
      //  -> For single props :
      //  subExtractorForVariantProp = {
      //    selector: <use the value from 'variant' prop extractor definition>,
      //    extract: <use the value from 'variant' prop extractor definition>,
      //    as : 'component.MediaGrid.variant',
      //    ... <any other keys from 'variant' prop extractor definition, e.g. 'emit'>
      //  }
      const fields = Object.keys(regroupedExtractors)

      // Debug.
      console.log('  Multiple extractors component definition')
      console.log('    component fields :')
      console.log(fields)

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]

        // Debug.
        console.log('    subExtractors :')
        console.log(regroupedExtractors[field].map(e => e.as))

        const subExtractors = regroupedExtractors[field]
        let newExtractor = { as: `${thing}.${type}.${field}` }

        // Simple props have a single extractor which can be used "as is".
        // Multi-field sub-items need 1 'extract' array item per field.
        if (subExtractors.length === 1) {
          newExtractor = subExtractors.pop()
        } else {
          // Selector fallback : use the component's extractor value. Then look
          // for a 'delimiter' key in child extractors if available.
          newExtractor.selector = componentExtractor.selector
          subExtractors.forEach(ex => {
            if ('delimiter' in ex) {
              newExtractor.selector = ex.delimiter
            }
          })
          newExtractor.extract = subExtractors
        }

        // Debug.
        // console.log('newExtractor :')
        // console.log(newExtractor)

        await run({
          extractor: newExtractor,
          parentExtractor: extractor,
          extracted: component,
          pageWorker,
          main,
          fieldOverride: field
        })
      }

      // Debug.
      // console.log('component :')
      // console.log(component)

      components.push(componentEntityToObject(component, type, fields))
    }
  }

  extracted[field] = components
}

/**
 * Transforms components extration result to match expected structure.
 *
 * Example extraction result (input) :
 *  { Lede: "<p>markup contents</p>" }
 * Expected structure (output) :
 *  { c: "Lede", props: { text: "<p>markup contents</p>" }}
 */
const componentEntityToObject = (componentEntity, type, prop) => {
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
  run,
  runSecondPass
}
