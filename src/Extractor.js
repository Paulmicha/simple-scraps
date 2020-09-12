const dom = require('./utils/dom')
const Collection = require('./composite/Collection')
const Iterator = require('./composite/Iterator')
const Container = require('./composite/Container')
const Leaf = require('./composite/Leaf')

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

    this.result = {}
    this.entityType = entityType
    this.bundle = bundle
    this.pageWorker = pageWorker
    this.main = main

    // Set all defined extraction config that match current destination, unless
    // directly specified in the op (for cases where a single URL is "hardcoded"
    // in the entry point).
    this.entityExtractionConfigs = []
    if ('extract' in op) {
      this.entityExtractionConfigs = op.extract
    } else {
      this.entityExtractionConfigs = this.mapConfig()
    }

    // Set recursive extraction configs (i.e. 'components' by default).
    this.recursiveExtractionConfigs = []
    this.main.getSetting('extractionContainerTypes').map(lookup => {
      this.recursiveExtractionConfigs = this.recursiveExtractionConfigs.concat(this.mapConfig(lookup))
    })

    // The extraction process uses 2 (composite tree) collections :
    // 1. to build a representation of all the selectors to run on given page
    // 2. to store the extraction result.
    this.selectorsCollection = new Collection()
    this.selectorsIterator = new Iterator(this.selectorsCollection)
    this.extractedCollection = new Collection()
    this.extractedIterator = new Iterator(this.extractedCollection)

    // Finally, the composite tree has a single shared "root" : the HTML
    // document itself (for Leaf instances extracted from <body>).
    this.rootElement = new Container('')
  }

  /**
   * Returns extraction definitions from main config.
   *
   * @param {string} lookup (optional) : specifies which configuration to get.
   *   Defaults to return the extraction configurations matching this.entityType
   *   and this.bundle. Otherwise, any value passed in this argument simply
   *   matches the corresponding key in main config (except 'start', which
   *   contains the entry points).
   *
   * @example
   *   // Given this main configuration object :
   *   this.main.config = {
   *     "start": [
   *       {
   *         "url": "http://example.com/blog",
   *         "follow": [
   *           {
   *             "selector": ".articles-list h2 > a",
   *             "to": "content/blog"
   *           },
   *           {
   *             "selector": ".articles-list .pager a",
   *             "to": "follow"
   *           }
   *         ]
   *       },
   *       ... (here, the rest of entry points)
   *     ],
   *     "content/*": [
   *       {
   *         "selector": "header h1.c-title",
   *         "extract": "text",
   *         "as": "entity.title"
   *       },
   *       ... (here, the rest of extraction configs)
   *     ],
   *     "content/blog": [
   *       {
   *         "selector": "article.node .field-name-field-tags > a",
   *         "extract": "text",
   *         "as": "entity.tags"
   *       },
   *       ... (here, the rest of extraction configs)
   *     ],
   *     "content/page": [
   *       {
   *         "selector": ".pane > .pane-content",
   *         "extract": "markup",
   *         "as": "entity.panes"
   *       },
   *       ... (here, the rest of extraction configs)
   *     ],
   *     "components": [
   *       ... (here, the components extraction configs)
   *     ]
   *   }
   *
   *   // This will return all extraction definitions matching the operation
   *   // destination (this.entityType and this.bundle), i.e. an array
   *   // containing all items of this.main.config['content/*'] and
   *   // this.main.config['content/blog'] - the '*' being a wildcard :
   *   const extractionConfigs = this.mapConfig()
   *
   *   // This would return all 'components' extraction configs (i.e.
   *   // this.main.config['components']) :
   *   const componentsExtractionConfigs = this.mapConfig('components')
   *
   *   // There is also support for wildcards - e.g. this would return all
   *   //  'content/*' extraction configs :
   *   const contentExtractionConfigs = this.mapConfig('content/*')
   */
  mapConfig (lookup) {
    let configs = []
    let lookupParts = [this.entityType, this.bundle]

    if (lookup) {
      if (lookup === 'start') {
        throw Error("Cannot map 'start' config in Extractor because it would match entry points (and not extraction configs as expected)")
      }

      // Simplest case : just return the matching key.
      if (!lookup.includes('/')) {
        if (!(lookup in this.main.config)) {
          return []
        }
        return this.main.config[lookup]
      }

      // Allow wildcard support for any key.
      lookupParts = lookup.split('/')
    }

    Object.keys(this.main.config)
      .filter(key => key !== 'start')
      .map(key => key.split('/'))
      .filter(keyParts => keyParts[0] === lookupParts[0] &&
        (keyParts[1] === lookupParts[1] || keyParts[1] === '*'))
      .map(keyParts => {
        configs = configs.concat(this.main.config[keyParts.join('/')])
      })

    return configs
  }

  /**
   * Populates the selectors collection based on extraction configs.
   *
   * We need to obtain instances of composite Leaf and Container classes to
   * represent what will be extracted :
   *   1. Single fields or properties of the main entity being extracted
   *     (because 1 Extractor works on 1 open page = 1 resulting object)
   *   2. Groups of multiple fields or properties (e.g. a component)
   *   3. Nested components as field or property value (either of the page being
   *     extracted or of one of its components)
   */
  init () {
    for (let i = 0; i < this.entityExtractionConfigs.length; i++) {
      const config = this.entityExtractionConfigs[i]
      const isContainer = this.isContainer(config)

      // If this extraction config has multiple sub-extraction configs, it must
      // be represented by a single composite instance having multiple fields or
      // properties (e.g. a component)
      if (Array.isArray(config.extract)) {
        if (isContainer) {
          config.instance = new Container(config.selector)
        } else {
          config.instance = new Leaf(config.selector)
        }

        config.extract.map(subExtractionConfig => {
          subExtractionConfig.parent = config

          // All sub-extraction configs are "working" on the same instance (the
          // group of fields or properties).
          subExtractionConfig.instance = config.instance

          // Any field or property of this group can contain nested components.
          if (this.recursiveExtractionConfigs.length) {
            this.setNestedExtractionConfig(subExtractionConfig, config)
          }

          this.selectorsCollection.add(subExtractionConfig)
        })
      } else {
        // Otherwise, we're dealing with individual fields or properties of the
        // main entity being extracted (i.e. at the root of the tree).
        config.instance = this.rootElement

        // A single field can still contain nested components.
        if (this.recursiveExtractionConfigs.length) {
          this.setNestedExtractionConfig(config)
        }

        this.selectorsCollection.add(config)
      }
    }
  }

  /**
   * Determines if current extraction config corresponds to a composite
   * container or leaf.
   *
   * @param {Object} config selector collection item
   */
  isContainer (config) {
    let hasNestedField = false

    if (Array.isArray(config.extract)) {
      config.extract.forEach(subConfig => {
        if (this.isContainer(subConfig)) {
          hasNestedField = true
        }
      })
    } else {
      hasNestedField = this.main.getSetting('extractionContainerTypes').includes(config.extract)
    }

    return hasNestedField
  }

  /**
   * TODO (wip) Nests extraction config for recursive fields or props lookups.
   *
   * The extraction config may contain fields (or props) that require
   * recursive processing. In this case, we reference the parent extraction
   * config for each nesting depth level in order to generate scoped
   * selectors - i.e. prefixed with ancestors selectors.
   */
  setNestedExtractionConfig (config, parentConfig) {
    if (!Array.isArray(config.extract) &&
      this.main.getSetting('extractionContainerTypes').includes(config.extract)) {
      this.addRecursiveExtractionConfigs(config, parentConfig)
    } else {
      config.extract.forEach(subExtractionConfig =>
        this.main.getSetting('extractionContainerTypes').includes(subExtractionConfig.extract) &&
        this.setNestedExtractionConfig(subExtractionConfig, config)
      )
    }
  }

  /**
   * TODO (wip) Adds nested extraction config to the selectors collection.
   *
   * @param {Object} config
   * @param {Object} parentConfig
   */
  addRecursiveExtractionConfigs (config, parentConfig) {
    this.recursiveExtractionConfigs.forEach(recursiveExtractionConfig => {
      const subExtractionConfig = { ...recursiveExtractionConfig }

      subExtractionConfig.nestedIn = config
      subExtractionConfig.scope = config.selector

      if (parentConfig) {
        subExtractionConfig.parentConfig = parentConfig
        subExtractionConfig.scope = `${parentConfig.selector} ${config.selector}`
      }

      this.selectorsCollection.add(subExtractionConfig)
    })
  }

  /**
   * TODO (wip) Returns the final resulting object.
   */
  async run () {
    // 1. Populate the selectors collection based on extraction configs.
    // 2. Sort the extraction steps to start from deepest levels ?
    this.init()

    // Debug.
    console.log(`Got ${this.selectorsCollection.count()} selectors to run.`)
    // while (this.selectorsIterator.hasMore()) {
    //   console.log('selectorsCollection item :')
    //   console.log(this.selectorsIterator.next())
    // }
    if (this.recursiveExtractionConfigs.length) {
      this.selectorsCollection.cycle(this.selectorsIterator, config => {
        console.log('selectorsCollection item :')
        console.log({
          selector: config.selector,
          nestedInSelector: config.nestedIn && config.nestedIn.selector,
          parentSelector: config.parent && config.parent.selector
        })
      })
    } else {
      this.selectorsCollection.cycle(this.selectorsIterator, config => {
        console.log('selectorsCollection item :')
        console.log(config)
      })
    }

    // 3. Run extraction steps (avoiding duplicates) and populate the
    // "extracted" collection.
    while (this.selectorsIterator.hasMore()) {
      await this.step({
        config: this.selectorsIterator.next()
      })
    }

    // 4. Generate the extraction result object from the "extracted" collection.
    this.extractedCollection.cycle(this.extractedIterator, extracted => {
      // Debug.
      console.log('extracted:')
      console.log(extracted)
    })

    return this.result
  }

  /**
   * TODO (wip) Processes an exctraction "step".
   *
   * This is called recursively to allow nested components extraction.
   *
   * The field or prop the given config will process is determined by the 'as'
   * config key. Examples :
   * - <thing>.<prop> (ex: entity.title, component.MediaGrid, etc)
   * - <thing>.<type>.<prop> (ex: component.Lede.text)
   * - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
   */
  async step (o) {
    // const { config, extracted, pageWorker, main, fieldOverride } = o
    // const { config, extracted, pageWorker, main, fieldOverride, debugIndent } = o
    const { config, extracted, fieldOverride, debugIndent } = o

    // this.extractedCollection

    // Preprocess selectors to handle scope in recusrive calls and customizations.
    // Also imposes a depth limit for nested extraction process to avoid infinite
    // recursions for components including components.
    // @see preprocessExtractor()
    // const carryOn = preprocessExtractor(o)
    // if (!carryOn) {
    //   return
    // }

    // By default, the field (or property) that is being extracted is the 2nd part
    // of the "as" key, but it needs to be overridable for nested components.
    const destination = config.as.split('.')
    let field = fieldOverride
    if (!field) {
      field = destination[1]
    }

    // Debug.
    // if (config.depth >= 3) {
    console.log(`${debugIndent || ''}step() ${field} for ${config.as}`)
    console.log(`${debugIndent || ''}  ${config.selector}`)
    // }

    // Support fields containing multiple items with props.
    // if (Array.isArray(config.extract)) {
    //   await subItemsFieldProcess({ config, extracted, field })
    //   return
    // }

    // Debug.
    console.log(`${debugIndent || ''}  extracting ${config.extract}`)

    // "Normal" process : config.extract is a string.
    switch (config.extract) {
      case 'text':
        extracted[field] = await dom.text(
          this.pageWorker.page,
          config.selector,
          this.main.getSetting('plainTextRemoveBreaks')
        )
        break
      case 'text_single':
        extracted[field] = await dom.textSingle(
          this.pageWorker.page,
          config.selector,
          this.main.getSetting('plainTextRemoveBreaks'),
          this.main.getSetting('plainTextSeparator')
        )
        break
      case 'markup':
        extracted[field] = await dom.markup(
          this.pageWorker.page,
          config.selector,
          this.main.getSetting('minifyExtractedHtml')
        )
        break
      // TODO implement an extraction for attribute(s).
      case 'element':
        await elementFieldProcess({ config, extracted, field })
        break
      // In order to support nested components extraction, we need to start from
      // the "deepest" nesting levels to avoid matching the same elements multiple
      // times. This is achieved by storing 'components' fields aside for later
      // processing during a second extraction pass, where we'll be able to scope
      // extraction and mark extracted components to avoid potential duplicates.
      // @see runrunSecondPass()
      case 'components': {
        await componentsFieldProcess({ config, extracted, field })

        // TODO other refactor in progress.
        /*
        // This placeholder sits in the exact place in the extracted object where
        // components will be looked for and merged during the second pass.
        const componentsFieldPlaceholder = {}
        extracted[field] = componentsFieldPlaceholder

        // Store references to placeholder objects in a single property directly
        // on the page worker instance for easier processing later on.
        // @see runSecondPass()
        this.pageWorker.extractionPlaceholders.push({
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

    this.extractedCollection.add(extracted)
  }
}

/**
 * Preprocessor allowing components nesting, scope, and custom selectors.
 *
 * This facilitates scope handling, allows customizations and jQuery-like
 * selector syntax if there is a DOM Query Helper available in browsed page(s).
 * @see Page.addDomQueryHelper()
 *
 * If the config has a 'preprocess' key, its value serves as the event
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
  const { config, parentExtractor } = o

  // Assign an "ancestor chain" string to the config. It will we used for
  // easier processing during the second pass for nested components extraction.
  // @see run()
  let ancestors = []
  let ancestorsChain = ''

  if (parentExtractor) {
    config.parent = parentExtractor
    ancestors = getExtractorAncestors(config)
    ancestorsChain = ancestors.map(e => e.as).join(' <- ') + ' <- '

    // Also assign a scope for current config, and prepend selector for
    // ensuring correct nesting during recusrive calls.
    // if (!('scope' in config)) {
    // console.log('-- there was already a scope on this config :')
    // console.log('  ' + config.scope)
    config.scope = parentExtractor.selector
    config.selector = `${parentExtractor.selector} ${config.selector}`
    // }
  }

  config.depth = ancestors.length
  config.ancestors = ancestors
  config.ancestorsChain = ancestorsChain + config.as

  // Impose a depth limit, otherwise there would be inevitable infinite loops
  // when components include other components.
  // TODO this does not prevent memory leaks when trying to extract instances of
  // a component inside itself. See below.
  if (config.depth > this.main.getSetting('maxExtractionNestingDepth')) {
    return false
  }
  // TODO find out why the fact of looking for a component instance inside
  // itself leads to memory leak, despite the limit on maximum depth. See above.
  if (ancestorsChain.includes(` <- ${config.as} <- `)) {
    // Debug.
    // console.log('')
    // console.log(`  Forbid to look for instances of a component inside itself (${config.as} in '${ancestorsChain}')`)
    // console.log('')
    return false
  }
  // TODO (archive) memory leak tracking failed attempt.
  // if (config.ancestorsChain.length) {
  //   console.log(`  check ${config.ancestorsChain} in this.pageWorker.componentsExtracted ...`)
  //   if (this.pageWorker.componentsExtracted.includes(config.ancestorsChain)) {
  //     // Debug.
  //     console.log(`  abort due to already processed ${config.ancestorsChain}`)
  //     return false
  //   }
  //   this.pageWorker.componentsExtracted.push(config.ancestorsChain)
  // }

  // Call any custom 'preprocess' implementations.
  if ('preprocess' in config) {
    this.main.emit(config.preprocess, o)
  }

  // Debug.
  // const debugIndent = '  '.repeat(config.depth)
  // console.log(`${debugIndent}depth ${config.depth} : ${config.ancestorsChain}`)
  // console.log(`${debugIndent}  ( ${config.selector} )`)

  // TODO [wip] next iteration :
  // Detect + convert jQuery-like syntax to normal CSS selectors (injects custom
  // classes).
  // if (this.main.getSetting('addDomQueryHelper')) {
  // }

  return true
}

/**
 * Returns an array of extractors that represents the "nesting chain".
 *
 * @param {object} config
 */
const getExtractorAncestors = (config) => {
  const ancestors = []
  while (config.parent) {
    ancestors.push(config.parent)
    config = config.parent
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
 *  objects, whose "title" is processed by a single sub-config run separately.
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
  const { config, extracted, field } = o

  // Debug.
  // console.log(`subItemsFieldProcess(${field})`)
  // console.log(config.extract)

  const subItem = {}
  // const subItemDelimiters = []

  while (config.extract.length) {
    const componentExtractor = config.extract.shift()
    // componentExtractor.selector = `${config.selector} ${componentExtractor.selector}`

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

    await this.step({
      config: componentExtractor,
      parentExtractor: config,
      extracted: subItem,
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
 * Emits an event corresponding to the value of config.emit which gets
 * an object representing the extraction details, and which expects it to be
 * altered to add a callback function in its 'callback' prop.
 *
 * Example callback function :
 *  items => items.map(item => item.innerHTML)
 */
const elementFieldProcess = async (o) => {
  const { config, extracted, field } = o

  if (!config.emit) {
    throw Error('Missing config "emit" config for processing ' + config.as + ', selector : ' + config.selector)
  }

  // Debug.
  // console.log(`emitting event '${config.emit}'`)

  // The event listeners may provide either :
  //  - a callback function which will be used by puppeteer's page.$$eval() API
  //  - the field value directly (takes precedence if set)
  this.main.emit(config.emit, o)

  if ('result' in o) {
    extracted[field] = o.result
    return
  }

  if (!o.callback) {
    throw Error('Missing callback for processing ' + config.as + ', selector : ' + config.selector)
  }
  extracted[field] = await element(this.pageWorker.page, config.selector, o.callback)
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
  console.log(`componentsFieldProcess() : ${o.config.as}`)

  const components = []
  const contexts = component.getExtractionContexts(o)

  for (let i = 0; i < contexts.length; i++) {
    const c = {}
    const context = contexts[i]
    context.extracted = c

    // Debug.
    // console.log(`  Will run extraction context : ${context.config.as} (type:${context.type}, props:${context.props})`)

    await run(context)

    // Debug.
    // console.log(`Look for ${o.config.as} / ${context.config.as} (depth : ${context.config.depth})`)
    // console.log(`  parents : ${context.config.ancestorsChain}`)

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

module.exports = Extractor
