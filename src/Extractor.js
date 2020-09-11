const dom = require('./utils/dom')

/**
 * Defines the process of extracting a structured object from a page.
 *
 * Loosely inspired by the design patterns Composite, Chain of Responsability,
 * and Iterator.
 *
 * TODO (wip) reorganization in progress
 */
class Extractor {
  constructor (op, pageWorker, main) {
    const [entityType, bundle] = op.to.split('/')

    // Get all defined extraction config that match current destination, unless
    // directly specified in the op (for cases where a single URL is "hardcoded"
    // in conf).
    let configs = []
    if ('extract' in op) {
      configs = op.extract
    } else {
      configs = this.mapConfig()
    }

    this.configs = configs
    this.result = {}
    this.entityType = entityType
    this.bundle = bundle
    this.pageWorker = pageWorker
    this.main = main
  }

  /**
   * Maps extraction definitions to entity type.
   */
  mapConfig () {
    let extractors = []

    Object.keys(this.main.config)
      .filter(key => key !== 'start')
      .map(key => key.split('/'))
      .filter(keyParts => keyParts[0] === this.entityType)
      .map(keyParts => {
        extractors = extractors.concat(this.main.config[keyParts.join('/')])
      })

    return extractors
  }

  /**
   * Returns the final resulting object.
   */
  async run () {
    // TODO (wip)
    return this.result
  }

  /**
   * Processes an exctraction "cycle".
   *
   * This is called recursively to allow nested components extraction.
   *
   * The field or prop the given extractor will process is determined by the 'as'
   * config key. Examples :
   * - <thing>.<prop> (ex: entity.title, component.MediaGrid, etc)
   * - <thing>.<type>.<prop> (ex: component.Lede.text)
   * - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
   */
  async step (o) {
    // const { extractor, extracted, pageWorker, main, fieldOverride } = o
    const { extractor, extracted, pageWorker, main, fieldOverride, debugIndent } = o

    // Preprocess selectors to handle scope in recusrive calls and customizations.
    // Also imposes a depth limit for nested extraction process to avoid infinite
    // recursions for components including components.
    // @see preprocessExtractor()
    const carryOn = preprocessExtractor(o)
    if (!carryOn) {
      return
    }

    // By default, the field (or property) that is being extracted is the 2nd part
    // of the "as" key, but it needs to be overridable for nested components.
    const destination = extractor.as.split('.')
    let field = fieldOverride
    if (!field) {
      field = destination[1]
    }

    // Debug.
    // if (extractor.depth >= 3) {
    console.log(`${debugIndent || ''}run() ${field} for ${extractor.as}`)
    console.log(`${debugIndent || ''}  ${extractor.selector}`)
    // }

    // Support fields containing multiple items with props.
    if (Array.isArray(extractor.extract)) {
      await subItemsFieldProcess({ extractor, extracted, pageWorker, main, field })
      return
    }

    // Debug.
    console.log(`${debugIndent || ''}  extracting ${extractor.extract}`)

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
          main.getSetting('plainTextRemoveBreaks'),
          main.getSetting('plainTextSeparator')
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
  // const { extractor, pageWorker, main, parentExtractor } = o
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
    // if (!('scope' in extractor)) {
    // console.log('-- there was already a scope on this extractor :')
    // console.log('  ' + extractor.scope)
    extractor.scope = parentExtractor.selector
    extractor.selector = `${parentExtractor.selector} ${extractor.selector}`
    // }
  }

  extractor.depth = ancestors.length
  extractor.ancestors = ancestors
  extractor.ancestorsChain = ancestorsChain + extractor.as

  // Impose a depth limit, otherwise there would be inevitable infinite loops
  // when components include other components.
  // TODO this does not prevent memory leaks when trying to extract instances of
  // a component inside itself. See below.
  if (extractor.depth > main.getSetting('maxExtractionNestingDepth')) {
    return false
  }
  // TODO find out why the fact of looking for a component instance inside
  // itself leads to memory leak, despite the limit on maximum depth. See above.
  if (ancestorsChain.includes(` <- ${extractor.as} <- `)) {
    // Debug.
    // console.log('')
    // console.log(`  Forbid to look for instances of a component inside itself (${extractor.as} in '${ancestorsChain}')`)
    // console.log('')
    return false
  }
  // TODO (archive) memory leak tracking failed attempt.
  // if (extractor.ancestorsChain.length) {
  //   console.log(`  check ${extractor.ancestorsChain} in pageWorker.componentsExtracted ...`)
  //   if (pageWorker.componentsExtracted.includes(extractor.ancestorsChain)) {
  //     // Debug.
  //     console.log(`  abort due to already processed ${extractor.ancestorsChain}`)
  //     return false
  //   }
  //   pageWorker.componentsExtracted.push(extractor.ancestorsChain)
  // }

  // Call any custom 'preprocess' implementations.
  if ('preprocess' in extractor) {
    main.emit(extractor.preprocess, o)
  }

  // Debug.
  // const debugIndent = '  '.repeat(extractor.depth)
  // console.log(`${debugIndent}depth ${extractor.depth} : ${extractor.ancestorsChain}`)
  // console.log(`${debugIndent}  ( ${extractor.selector} )`)

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
  // const subItemDelimiters = []

  while (extractor.extract.length) {
    const componentExtractor = extractor.extract.shift()
    // componentExtractor.selector = `${extractor.selector} ${componentExtractor.selector}`

    const multiFieldItemProp = componentExtractor.as.split('.').pop()

    // Delimiters use "markers" that are directly set on the DOM element defined
    // as scope for every single child item. They are data-attributes containing
    // a counter.
    // const destination = componentExtractor.as.split('.')

    // TODO (wip) this will be implemented when we write tests.
    // const destArrCursors = []
    // destination.forEach((fragment, i) => {
    //   if (fragment.indexOf('[]') !== false) {
    //     destArrCursors.push(i)
    //   }
    // })

    // Debug.
    // subItemDelimiters.push(destination.join('.'))
    console.log(`    subItemsFieldProcess() ${multiFieldItemProp} for ${componentExtractor.as}`)
    // console.log(`      ${componentExtractor.selector}`)

    await run({
      extractor: componentExtractor,
      parentExtractor: extractor,
      extracted: subItem,
      pageWorker,
      main,
      fieldOverride: multiFieldItemProp,
      debugIndent: '      '
    })
  }

  // Nothing to do when nothing matched.
  if (JSON.stringify(subItem) === '{}') {
    return
  }

  // Debug.
  // console.log(`  TODO (wip) implement delimiters for ${subItemDelimiters.join(', ')}`)

  // Debug.
  console.log('  subItem :')
  console.log(subItem)

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
  console.log('  subItems :')
  console.log(subItems)

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
  const { extracted, field } = o

  // Debug.
  console.log(`componentsFieldProcess() : ${o.extractor.as}`)

  const components = []
  const contexts = component.getExtractionContexts(o)

  for (let i = 0; i < contexts.length; i++) {
    const c = {}
    const context = contexts[i]
    context.extracted = c

    // Debug.
    // console.log(`  Will run extraction context : ${context.extractor.as} (type:${context.type}, props:${context.props})`)

    await run(context)

    // Debug.
    // console.log(`Look for ${o.extractor.as} / ${context.extractor.as} (depth : ${context.extractor.depth})`)
    // console.log(`  parents : ${context.extractor.ancestorsChain}`)

    // TODO why empty object has Object.keys(c).length of 1 ?
    // if (Object.keys(c).length !== 0) {
    if (JSON.stringify(c) !== '{}') {
      // Debug.
      // console.log(`  result : ${JSON.stringify(c)} (${Object.keys(c).length})`)

      // components.push(component.transformObject(c, context.type, context.props))
      components.push(c)

      // } else {
      //   // Debug.
      //   console.log('  nothing matched.')
    }
  }

  extracted[field] = components
}

module.exports = {
  Extractor
}