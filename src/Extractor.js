const dom = require('./utils/dom')
const Collection = require('./composite/Collection')
const Step = require('./composite/Step')
const Container = require('./composite/Container')
const Leaf = require('./composite/Leaf')
const ExportVisitor = require('./composite/ExportVisitor')

/**
 * Defines the process of extracting a structured object from a page.
 *
 * Loosely inspired by the design patterns Composite, Iterator, and Visitor.
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
    this.rootExtractionConfigs = []
    if ('extract' in op) {
      this.rootExtractionConfigs = op.extract
    } else {
      this.rootExtractionConfigs = this.mapConfig()
    }

    // Set recursive extraction configs (i.e. 'components' by default).
    this.nestedExtractionConfigs = []
    this.main.getSetting('extractionContainerTypes').map(lookup => {
      this.nestedExtractionConfigs = this.nestedExtractionConfigs.concat(this.mapConfig(lookup))
    })

    // Make recursive lookups conditional.
    this.isRecursive = false
    if (this.nestedExtractionConfigs.length > 0) {
      this.isRecursive = true
    }

    // The extraction process uses a composite tree collection to store a
    // representation of all the selectors to extract (i.e. Step instances), and
    // another collection for extraction results which are structured
    // differently (Component instances -> Container, Leaf).
    this.steps = new Collection()
    this.iterator = this.steps.createIterator()
    this.extracted = new Collection()
    this.extractedIterator = this.extracted.createIterator()

    // Finally, all extracted components will share a single "root" : the HTML
    // document itself. Either we have nested components configs which require
    // recursive lookups, or we simply extract 1 or more fields of the same
    // root entity.
    this.rootComponent = this.iterableFactory({ type: 'rootComponent', scope: '' })
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
   * Binds Iterable composite instances creation and scoping.
   */
  iterableFactory (spec) {
    const { type, scope, config } = spec
    let instance
    let instanceParentField

    // Debug.
    // console.log(`iterableFactory() : ${JSON.stringify(spec)}`)
    console.log(`iterableFactory() : ${Object.keys(spec)} (type = ${type})`)
    if (config) {
      console.log(`  '${config.extract}' as ${config.as}`)
      if (config.parent && config.parent.as) {
        console.log(`    via '${config.parent.extract}' as ${config.parent.as}`)
      }
    }

    switch (type) {
      case 'step':
        instanceParentField = 'parent'

        instance = new Step(config, this.main)

        this.steps.add(instance)
        break

      case 'component':
        instanceParentField = 'container'

        if (this.isContainer(config)) {
          instance = new Container(config)
        } else {
          instance = new Leaf(config)
        }

        if (config.component) {
          instance.setContainer(config.component)
        }

        this.extracted.add(instance)
        break

      // The root component is like the <html> tag (it's the common ancestor
      // that will be shared by all extracted components).
      case 'rootComponent':
        instanceParentField = 'container'

        if (this.isRecursive) {
          instance = new Container()
        } else {
          instance = new Leaf()
        }

        this.extracted.add(instance)
        break
    }

    // All iterable objects share the following initialization steps.
    instance.setAncestors(this.getAncestors(instance, instanceParentField))
    instance.setScope(scope)

    return instance
  }

  /**
   * Determines if given extraction config corresponds to a composite container
   * or leaf component.
   */
  isContainer (config) {
    if (Array.isArray(config.extract)) {
      for (let i = 0; i < config.extract.length; i++) {
        const subConfig = config.extract[i]
        if (this.isContainer(subConfig)) {
          return true
        }
      }
    } else {
      // Debug
      console.log(`isContainer(${config.extract}) ? -> ${this.main.getSetting('extractionContainerTypes').includes(config.extract)}`)

      return this.main.getSetting('extractionContainerTypes').includes(config.extract)
    }
    return false
  }

  /**
   * Returns an array of objects that represents a "nesting chain" from current
   * depth level to the root (depth 0).
   *
   * @param {Object} object Any object with a field optionally containing its
   *   parent object.
   * @param {string} parentField (optional) The field or property containing the
   *   parent object value. Defaults to 'parent'.
   */
  getAncestors (object, parentField) {
    const ancestors = []
    if (!parentField) {
      parentField = 'parent'
    }

    // Debug.
    // console.log(`getAncestors(object, '${parentField}') for ${object.constructor.name}`)
    // console.log(`  keys: ${Object.keys(object)}`)
    // console.log(`  object[parentField] = ${JSON.stringify(object[parentField])}`)

    while (object[parentField]) {
      ancestors.push(object[parentField])
      object = object[parentField]
    }

    // Debug.
    // console.log(ancestors.map(a => JSON.stringify(a)))

    return ancestors.reverse()
  }

  /**
   * Populates the composite collection based on extraction configs.
   *
   * Step class instances are the Collection items which are traversable via
   * Iterator and exportable via ExportVisitor.
   *
   * We need to obtain instances of composite Component classes (Leaf and
   * Container) to represent what will be extracted (in as many steps as there
   * are selectors to run - i.e. one step per Component field or prop) :
   *   1. Single fields or properties of the main entity being extracted
   *     (because 1 Extractor works on 1 open page = 1 resulting object)
   *   2. Groups of multiple fields or properties (e.g. a component)
   *   3. Nested components as field or property value (either of the page being
   *     extracted or of one of its components)
   */
  init (configs, parent, nestingLevel) {
    if (!nestingLevel) {
      nestingLevel = 0
    }

    for (let i = 0; i < configs.length; i++) {
      const config = { ...configs[i] }

      config.parent = parent

      // If this extraction config has multiple sub-extraction configs, it must
      // be represented by a single composite instance having 1 or more fields
      // or properties (i.e. an instance of Component -> Container or Leaf).
      if (Array.isArray(config.extract)) {
        config.component = this.iterableFactory({
          type: 'component',
          scope: parent.selector,
          config
        })

        config.extract.map(subExtractionConfig => {
          subExtractionConfig.parent = config

          // All sub-extraction configs are "working" on the same instance (the
          // group of fields or properties).
          subExtractionConfig.component = config.component

          // Any field or property of this group can contain nested components.
          if (this.isRecursive && nestingLevel < this.main.getSetting('maxExtractionNestingDepth')) {
            this.setNestedExtractionConfig(subExtractionConfig)
          }

          this.iterableFactory({
            type: 'step',
            config
          })
        })
      } else {
        // Otherwise, we're dealing with individual fields or properties of the
        // main entity being extracted (i.e. at the root of the tree) or, if
        // called in recursive components lookup, of the component representing
        // what would be extracted if a match exists at this nesting depth.
        config.component = parent.component

        // A single field can still contain nested components.
        if (this.isRecursive && nestingLevel < this.main.getSetting('maxExtractionNestingDepth')) {
          this.setNestedExtractionConfig(config)
        }

        this.iterableFactory({
          type: 'step',
          config
        })
      }
    }
  }

  /**
   * Nests extraction config for recursive fields or props lookups.
   *
   * The extraction config may contain fields (or props) that require
   * recursive processing. In this case, we reference the parent extraction
   * config for each nesting depth level in order to generate scoped
   * selectors - i.e. prefixed with ancestors selectors.
   *
   * @example
   *   // This extraction config sample represents what would trigger the
   *   // recursive calls to this.init() - if 'components' is part of the
   *   // 'extractionContainerTypes' setting, which is the case by default :
   *   {
   *     "extract": "components",
   *     "as": "entity.content"
   *   }
   */
  setNestedExtractionConfig (config) {
    if (Array.isArray(config.extract)) {
      config.extract.forEach(subExtractionConfig =>
        this.main.getSetting('extractionContainerTypes').includes(subExtractionConfig.extract) &&
        this.setNestedExtractionConfig(subExtractionConfig, config)
      )
    } else if (this.main.getSetting('extractionContainerTypes').includes(config.extract)) {
      const nestingLevel = this.getConfigNestingLevel(config)

      if (nestingLevel < this.main.getSetting('maxExtractionNestingDepth')) {
        // Debug.
        console.log(`recursive call to init() at nestingLevel ${nestingLevel} :`)
        console.log(this.nestedExtractionConfigs)

        this.init(this.nestedExtractionConfigs, config, nestingLevel)
      }
    }
  }

  /**
   * Returns the "nesting level" of given extraction config object.
   *
   * @param {Object} config A single extraction config object.
   */
  getConfigNestingLevel (config) {
    const ancestors = this.getAncestors(config)
    if (ancestors.length) {
      return ancestors.length - 1
    }
    return 0
  }

  /**
   * Returns the final resulting object.
   */
  async run () {
    // 1. Populate the composite collection based on extraction configs.
    // Start with root configs on root element, then recurse (if needed).
    // @see setNestedExtractionConfig()
    this.init(this.rootExtractionConfigs, { component: this.rootComponent })

    // Debug.
    console.log(`Got ${this.steps.count()} selectors to run.`)

    // Debug.
    console.log('Before sorting :')
    this.iterator.traverse(step => step.locate())

    // 2. TODO (wip) Sort the extraction steps to start from deepest levels ?
    this.iterator.sort()

    // Debug.
    console.log('After sorting :')
    this.iterator.traverse(step => step.locate())

    // 3. Execute the actual extraction using the pageWorker.
    // TODO (wip) Run all (optional) custom processes before extraction ?
    // This could be run instead of the normal process() call. See what makes
    // most sense later.
    // If the config has a 'preprocess' key, its value serves as the event
    // emitted to allow custom implementations that would prepare elements (e.g.
    // add custom classes) to facilitate the extraction process.
    await this.iterator.traverseAsync(async step => {
      if ('emit' in step) {
        await this.main.emit(step.emit, step, this)
      }
    })
    await this.iterator.traverseAsync(async step => await this.process(step))

    // Debug.
    console.log('Extracted components :')
    this.extractedIterator.traverse(component => component.locate())

    // 4. Generate the extraction result object.
    // When no nested fields were found, we are extracting a single entity from
    // the entire page. Otherwise, the result will need to be built recursively.
    const exporter = new ExportVisitor(this.extractedIterator)
    switch (this.rootComponent.constructor.name) {
      case 'Leaf':
        this.result = exporter.visitLeaf(this.rootComponent)
        break
      case 'Container':
        this.result = exporter.visitContainer(this.rootComponent)
        break
    }

    return this.result
  }

  /**
   * Processes an exctraction "step".
   *
   * This is called recursively to allow nested components extraction.
   *
   * The field or prop the given config will process is determined by the 'as'
   * config key. Examples :
   * - <thing>.<prop> (ex: entity.title, component.MediaGrid, etc)
   * - <thing>.<type>.<prop> (ex: component.Lede.text)
   * - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
   */
  async process (step, debugIndent) {
    const component = step.getComponent()
    const field = step.getField()

    // Debug.
    // if (config.depth >= 3) {
    console.log(`${debugIndent || ''}step() ${field} for ${step.as}`)
    console.log(`${debugIndent || ''}  ${step.selector}`)
    // }

    // Support fields containing multiple items with props.
    // if (Array.isArray(config.extract)) {
    //   await subItemsFieldProcess({ config, extracted, field })
    //   return
    // }

    // Debug.
    console.log(`${debugIndent || ''}  extracting ${step.extract}`)

    // "Normal" process : config.extract is a string.
    switch (step.extract) {
      case 'text': {
        // const value = await dom.text(
        component.setField(field, await dom.text(
          this.pageWorker.page,
          step.selector,
          this.main.getSetting('plainTextRemoveBreaks')
        ))
        // )

        // debug.
        // console.log('value for field ' + field)
        // console.log(value)

        // component.setField(field, value)

        break
      }
      case 'text_single':
        component.setField(field, await dom.textSingle(
          this.pageWorker.page,
          step.selector,
          this.main.getSetting('plainTextRemoveBreaks'),
          this.main.getSetting('plainTextSeparator')
        ))
        break
      case 'markup':
        component.setField(field, await dom.markup(
          this.pageWorker.page,
          step.selector,
          this.main.getSetting('minifyExtractedHtml')
        ))
        break

      // TODO (wip) refactor in progress.
      // TODO implement an extraction for attribute(s).
      case 'element':
        await elementFieldProcess({ step, component, field })
        break

      // TODO (wip) refactor in progress : need to make recursive calls

      // In order to support nested components extraction, we need to start from
      // the "deepest" nesting levels to avoid matching the same elements multiple
      // times. This is achieved by storing 'components' fields aside for later
      // processing during a second extraction pass, where we'll be able to scope
      // extraction and mark extracted components to avoid potential duplicates.
      // @see runrunSecondPass()
      case 'components':
        component.setField(field, {
          c: step.as.split('.')[1],
          props: { ...component.extracted }
        })

        // Debug.
        // console.log('component scope = ' + step.getScope())
        console.log(component)

        // await componentsFieldProcess({ config, component, field })

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

    await this.process({
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
