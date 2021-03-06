const Hashids = require('hashids')
const dom = require('./utils/dom')
const Collection = require('./composite/Collection')
const Step = require('./composite/Step')
const Container = require('./composite/Container')
const Leaf = require('./composite/Leaf')
const ExportVisitor = require('./composite/ExportVisitor')

/**
 * Defines the process of extracting a structured object from a page.
 *
 * A single page may contain a single entity to extract (with multiple fields),
 * or it can contain sub-entities like components, each having their own fields
 * or props, and which are potentially nested (i.e. components containing other
 * sub-components).
 *
 * Loosely inspired by the design patterns Composite, Iterator, and Visitor.
 *
 * Collection items are all sub-classes of Iterable, which are traversable via
 * Iterator and exportable via ExportVisitor.
 *
 * Order of operations :
 *   1. INIT phase : converts extraction config into composite trees. Start with
 *     the root of the DOM (<body>) and scopes selectors recursively until we've
 *     reached the deepest existing elements matching provided configs.
 *     Component (= Container or Leaf) instances are created first, then Step
 *     instances (as they are attached to their Component instances).
 *   2. EXTRACTION phase : associates values to the composite tree items
 *     starting from the deepest nesting levels. This allows to produce objects
 *     that are already structured in a way that makes easier the export phase
 *     i.e. when reaching Container components, their children would already
 *     have their fields or props "populated".
 *   3. EXPORT phase : outputs extracted values into the expected format.
 *
 * During the INIT phase, "fallback" extraction configs can provide additional
 * selectors to look for values that would be used for certain fields or props.
 * During the EXTRACTION phase, "fallback" lookups may also be triggered if the
 * "normal" process does not produce any output.
 */
class Extractor {
  constructor (op, pageWorker, main) {
    const [entityType, bundle] = op.to.split('/')

    this.result = {}
    this.entityType = entityType
    this.bundle = bundle
    this.pageWorker = pageWorker
    this.main = main

    // We'll need to check wether selectors match anything at all in the page,
    // and if they have already been extracted in case elements get matched
    // multiple times from higher depth levels.
    this.selectorExists = {}
    this.selectorsExtracted = []

    // In order to support selectors using jQuery-like syntax, we need a unique
    // counter for hash IDs to track custom classes added to the page elements
    // that need to be "marked".
    // @see Iterable.scopeSelector()
    // The same counter is used for link IDs between component instances and
    // their corresponding DOM elements (we don't care about mixing both use
    // cases in the same counter here, because we just need unique numbers per
    // extraction process).
    // @see Component.setComponentID()
    this.markedElementsCount = 0
    this.hashids = new Hashids('SimpleScraps', 10)

    // These classes are used to avoid duplicates when differenciating
    // components or when processing the extraction.
    const initialHash = this.hashids.encode(1)
    this.alreadyExtractedClass = 'already-extracted-' + initialHash
    this.alreadyDifferenciatedClass = 'already-dif-' + initialHash

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

    // Make recursive lookups optional.
    this.isRecursive = false
    if (this.nestedExtractionConfigs.length > 0) {
      this.isRecursive = true
    }

    // The extraction process uses 2 composite tree collections to store :
    //   1. all the selectors to extract (i.e. Step instances),
    //   2. the extraction results (i.e. Component instances = Container, Leaf).
    // This allows to run multiple selectors to extract a single component with
    // multiple fields or properties (each selector to run corresponding to a
    // Step instance).
    // Example of a multi-props component :
    // {
    //   "selector": ".card",
    //   "extract": [
    //     {
    //       "selector": "> .card-header",
    //       "extract": "text_single",
    //       "as": "component.Card.header"
    //     },
    //     {
    //       "selector": "> .card-body > .card-title",
    //       "extract": "text_single",
    //       "as": "component.Card.title"
    //     },
    //     {
    //       "selector": "> .card-body > .card-text",
    //       "extract": "text_single",
    //       "as": "component.Card.text"
    //     }
    //   ],
    //   "as": "component.Card"
    // }
    // In this example, we have 1 component that will be processed in 4 steps :
    // - 1 for the component itself - initially empty (if its selector
    //   ".card" does not match anything, then nothing will be added to both
    //   steps and extracted collection)
    // - 3 for the component properties (i.e. each "extract" extraction config),
    //   which will populate the initially empty component instance.
    this.stepsCollection = new Collection()
    this.stepsIterator = this.stepsCollection.createIterator()
    this.componentsCollection = new Collection()
    this.componentsIterator = this.componentsCollection.createIterator()

    // Finally, all extracted components will share a single "root" : the HTML
    // document itself. Either we have nested components configs which require
    // recursive lookups, or we simply extract 1 or more fields of the same
    // root entity.
    // Also define the corresponding extraction config representation.
    this.rootExtractionConfig = { selector: ':root', extract: '*', as: 'rootComponent' }
    if (this.isRecursive) {
      this.rootComponent = new Container(this, this.rootExtractionConfig)
    } else {
      this.rootComponent = new Leaf(this, this.rootExtractionConfig)
    }
    this.componentsCollection.add(this.rootComponent)
  }

  /**
   * Returns extraction definitions from main config.
   *
   * The field or prop is determined by the 'as' config key. Examples :
   * - <thing>.<prop> (ex: entity.title, component.MediaGrid, etc)
   * - <thing>.<type>.<prop> (ex: component.Lede.text)
   * - <thing>.<type>.<nested>[].<prop> (ex: component.MediaGrid.items[].image)
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
   * Binds Iterable composite instances creation and scoping during init().
   *
   * 'Component' instances ('Leaf' and 'Container') are always created *before*
   * 'Step' instances.
   */
  async iterableFactory (spec) {
    const { type, config, newComponent } = spec
    let instance

    if (!config) {
      throw Error('Missing config in iterableFactory()')
    }

    // The 'newComponent' key allows to override the component which is going to
    // receive the extracted values specified by given config.
    // TODO (minor) choose better variable names to represent explicitly the
    // difference between parent and current which only makes sense for Step
    // instances ?
    const parentComponent = config.component
    if (newComponent) {
      config.component = newComponent
    }

    if (!config.component) {
      throw Error('Missing component in iterableFactory()')
    }

    // Ne need to instanciate anything if we're inside a scope which doesn't
    // match any element in the page.
    // const scopeExists = await config.component.selectorExists()
    // if (!scopeExists) {
    //   // Debug.
    //   // console.log(`    iterableFactory(${type}) : scope not found (${config.component.getSelector()})`)
    //   console.log(`iterableFactory(${type}) : scope not found (${config.component.getSelector()})`)
    //   // console.log(`  -> fallback ? '${config.fallback}'`)

    //   // TODO (wip)
    //   // if (!('fallback' in config)) {
    //   //   return
    //   // }
    // }

    switch (type) {
      case 'step': {
        instance = new Step(this, config)

        // Set parent / ancestors scope.
        instance.setParentComponent(parentComponent)

        // Scope the selector.
        instance.setAncestors()
        await instance.scopeSelector()

        // In case of multi-field props, mark delimiters (if defined).
        if (instance.isMultiField()) {
          await instance.setMultiFieldIndexes()
        }

        // If this step's component selector differs from this step's and
        // doens't match anything, there's no need to check it.
        const component = instance.getComponent()
        if (component.getSelector() !== instance.getSelector() && !await component.selectorExists()) {
          // Debug.
          // console.log('  -> step is inside component with a selector that does not exist')
          // instance.locate()

          // In this case, check fallback directly.
          if ('fallback' in config && 'selector' in config.fallback) {
            await this.createFallbackStep(config, parentComponent, newComponent)
          }
          break
        }

        // If nothing matches scoped selector, do not add it to the collection.
        if (await instance.selectorExists()) {
          this.stepsCollection.add(instance)
        } else {
          // Debug.
          // console.log(`KO iterableFactory(${type}) - lv.${instance.getDepth()} for ${instance.getComponent().getName()}.${instance.getField()}`)
          // console.log(`   Step selector not found : ${instance.getSelector()}`)

          // Instead, look for a fallback : if it has a selector, it should
          // be tried and if it matches anything, it should be added to the
          // collection.
          if ('fallback' in config && 'selector' in config.fallback) {
            await this.createFallbackStep(config, parentComponent, newComponent)
          }
        }
        break
      }

      case 'component': {
        if (this.isContainer(config)) {
          instance = new Container(this, config)
        } else {
          instance = new Leaf(this, config)
        }

        // Set parent / ancestors scope.
        instance.setParentComponent(config.component)

        // Scope the selector.
        instance.setAncestors()
        await instance.scopeSelector()

        // Debug.
        // console.log(`iterableFactory(${type}) - lv.${instance.getDepth()} ${instance.getName()} (${instance.constructor.name}) <- ${instance.getAncestorsChain()}`)

        // If nothing matches scoped selector, do not add it to the collection.
        if (await instance.selectorExists()) {
          // We need to deal with the possibility of multiple components
          // existing in the same container, ex: 2 BlockQuotes inside the same
          // Accordion item.
          // If there are several components found, we need a differenciator
          // that will be used to scope all the steps' selectors (which must be
          // run for each instance).
          // TODO (wip) debug.
          // if (config.as === 'component.BlockQuote') {
          //   console.log(`iterableFactory(${type}) - lv.${instance.getDepth()} ${instance.getName()} (${instance.constructor.name}) <- ${instance.getAncestorsChain()}`)
          //   console.log(`  selector : ${instance.getSelector()}`)
          //   const markupMatches = await dom.markup(this.pageWorker.page, instance.getSelector())
          //   if (Array.isArray(markupMatches)) {
          //     console.log(`  matches : ${markupMatches.length}`)
          //   } else {
          //     console.log(`  1 match (length = ${markupMatches.length})`)
          //   }
          // }

          this.componentsCollection.add(instance)

          // Debug.
          // console.log(`iterableFactory(${type}) - lv.${instance.getDepth()} ${instance.getName()} (${instance.constructor.name}) <- ${instance.getAncestorsChain()}`)
          // console.log(`   ${instance.getSelector()}`)
        } else {
          // Debug.
          // console.log(`KO iterableFactory(${type}) - lv.${instance.getDepth()} ${instance.getName()} (${instance.constructor.name}) <- ${instance.getAncestorsChain()}`)
          // console.log(`   Component selector not found : ${instance.getSelector()}`)

          // Instead, look for a fallback : if it has a selector, it should
          // be tried and if it matches anything, it should be added to the
          // collection.
          if ('fallback' in config && 'selector' in config.fallback) {
            await this.createFallbackStep(config, config.component)
          }
        }
        break
      }
    }

    return instance
  }

  /**
   * Tries to create a new step when a selector didn't match anything in the
   * page, or when process() detects a missing prop after extract().
   *
   * @param {Object} config of step with a selector that matched nothing.
   * @param {Component} parentComponent of that step.
   * @param {Component} newComponent (optional) if created in init().
   */
  async createFallbackStep (config, parentComponent, newComponent) {
    if (!('fallback' in config)) {
      return
    }

    const currentConfig = { ...config }
    const fallbackConfig = currentConfig.fallback

    // Debug.
    const component = newComponent || parentComponent
    // console.log(`createFallbackStep() - ${config.extract} as ${config.as}`)
    console.log(`createFallbackStep() - lv.${component.getDepth()} for ${component.getName()}`)
    // console.log(`  ${config.extract} as ${config.as}`)
    // console.log(`fallbackConfig = ${JSON.stringify(fallbackConfig, null, 2)}`)

    fallbackConfig.component = parentComponent
    delete currentConfig.fallback

    return await this.iterableFactory({
      type: 'step',
      config: { ...currentConfig, ...fallbackConfig },
      newComponent
    })
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
      // console.log(`isContainer(${config.extract}) ? -> ${this.main.getSetting('extractionContainerTypes').includes(config.extract)}`)

      return this.main.getSetting('extractionContainerTypes').includes(config.extract)
    }
    return false
  }

  /**
   * Populates the composite collections based on extraction configs.
   *
   * We need to obtain instances of composite Component classes (Leaf and
   * Container) to represent what will be extracted, in as many steps as there
   * are selectors to run - i.e. one step per Component field or prop.
   *
   * We also need Step instances to represent all these individual extraction
   * processes :
   *
   *   1. Single fields or properties of the "main" entity being extracted
   *     (because the Extractor class works on 1 open page = 1 "main" object),
   *   2. Groups of multiple fields or properties (e.g. a component),
   *   3. Nested components as field or property value, either of the page being
   *     extracted or of one of its components.
   *
   * If a config 'extract' key is not an array and has a destination ('as' key)
   * corresponding to a component prop, when that component name differs from
   * its container, we assume that component is to be extracted as a single prop
   * component. Like in the following config, for instance - the first and only
   * occurence of the 'Lede' component in ht ewhold config is directly
   * 'component.Lede.text') :
   *   "components": [
   *     {
   *       "selector": "header.jumbotron > .container *:not(h1)",
   *       "extract": "text_single",
   *       "as": "component.Lede.text"
   *     },
   *     ... (rest of components extraction configs)
   *   ]
   */
  async init (configs, parentConfig, nestingLevel, parentStep) {
    const container = parentConfig.component

    if (!nestingLevel) {
      nestingLevel = 0
    }

    for (let i = 0; i < configs.length; i++) {
      let newComponent = null
      const config = { ...configs[i] }
      const destination = config.as.split('.')

      config.parent = { ...parentConfig }
      config.component = container

      if (parentStep) {
        config.parentStep = parentStep
      }

      // Debug.
      // console.log(`init() lv.${nestingLevel} config ${i + 1}/${configs.length}`)
      // console.log(`  container : ${container.getName()} <- ${container.getAncestorsChain()}`)

      // TODO (evol) since we have a setting to customize the container types,
      // we should alo have a way to specify the corresponding "destination".
      // e.g. reuse 'extractionContainerTypes' and allow it to contain either an
      // array of trings (like now) or (todo) an array of mapping objects ?
      if (destination[0] === 'component' &&
        (destination.length === 2 || container.getName() !== destination[1])) {
        // Debug.
        // console.log(`    Create new component : '${config.as}'`)

        // TODO (wip) :
        // We need to deal with the possibility of multiple components existing
        // in the same container, ex: 2 BlockQuotes inside the same Accordion
        // item.
        // If there are several components found, we need a differenciator that
        // will be used to scope all the steps' selectors (which must be run for
        // each instance).

        newComponent = await this.iterableFactory({
          type: 'component',
          config,
          newComponent
        })
        container.add(newComponent)
      }

      // If this extraction config has multiple sub-extraction configs, it will
      // result in a single component where each sub-extraction config will
      // process one field or prop of that same component.
      if (Array.isArray(config.extract)) {
        // Debug.
        // console.log('  config.extract is an array')
        // console.log('  -> component :')
        // console.log(config.component.locate('    '))

        for (let j = 0; j < config.extract.length; j++) {
          const subExtractionConfig = config.extract[j]
          subExtractionConfig.parent = config

          // All sub-extraction configs are "working" on the same instance (the
          // group of fields or properties).
          subExtractionConfig.component = newComponent || container

          const step = await this.iterableFactory({
            type: 'step',
            config: subExtractionConfig,
            newComponent
          })

          // Any field or property of this group can contain nested components.
          if (this.isRecursive && nestingLevel < this.main.getSetting('maxExtractionNestingDepth')) {
            await this.nestExtractionConfig(subExtractionConfig, nestingLevel, step)
          }
        }
      } else {
        // Otherwise, we're dealing with a single field or property.
        // It could be belonging to the page document root, or to a component
        // that has a single field setup for extraction.
        const step = await this.iterableFactory({
          type: 'step',
          config,
          newComponent
        })

        // A single field can still contain nested components.
        if (this.isRecursive && nestingLevel < this.main.getSetting('maxExtractionNestingDepth')) {
          await this.nestExtractionConfig(config, nestingLevel, step)
        }
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
   *     "selector": "body > main",
   *     "extract": "components",
   *     "as": "entity.content"
   *   }
   *   // In this example, the 'content' field of the entity to extracted would
   *   // trigger a recursive lookup of all components defined elsewhere in the
   *   // main config under the 'components' key.
   *   // When the 'selector' key is set, it constrains the components lookup
   *   // within its scope - i.e. it will only match descendants of the
   *   // element(s) corresponding to the selector.
   *
   * For a complete extraction config example,
   * @see test/config/components_nested.json
   */
  async nestExtractionConfig (config, nestingLevel, step) {
    if (step && !this.selectorExists[step.getSelector()]) {
      return
    }
    if (this.main.getSetting('extractionContainerTypes').includes(config.extract)) {
      nestingLevel++
      if (nestingLevel < this.main.getSetting('maxExtractionNestingDepth')) {
        await this.init(this.nestedExtractionConfigs, config, nestingLevel, step)
      }
    }
  }

  /**
   * Returns the final resulting object.
   */
  async run () {
    // 1. Populate the composite collection based on extraction configs.
    // Start with root configs on root element, then recurse (if needed).
    // @see nestExtractionConfig()
    await this.init(this.rootExtractionConfigs, {
      component: this.rootComponent,
      selector: ':root'
    })

    // 2. Detect multiple components instances in same scope.
    this.componentsIterator.sort()
    await this.componentsIterator.traverseAsync(
      async component => await this.preprocess(component)
    )

    // Debug.
    // console.log(`run() ${this.stepsCollection.count()} selectors, ${this.componentsCollection.count()} components.`)
    // console.log(`  this.selectorExists = ${JSON.stringify(this.selectorExists, null, 2)}`)

    // Debug.
    // console.log('Before sorting :')
    // this.stepsIterator.traverse(step => step.locate())

    // 2. Sort the extraction steps to start from deepest levels.
    this.stepsIterator.sort()

    // Debug.
    // console.log('After sorting :')
    // this.stepsIterator.traverse(step => step.locate())

    // 4. Execute the actual extraction using the pageWorker.
    await this.stepsIterator.traverseAsync(async step => await this.process(step))

    // Debug.
    // console.log('Extracted selectors :')
    // console.log(this.selectorsExtracted)
    // console.log('Extracted components :')
    // this.componentsIterator.traverse(component => component.locate())

    // 5. Generate the extraction result object.
    // When no nested fields were found, we are extracting a single entity from
    // the entire page. Otherwise, the result will need to be built recursively.
    const exporter = new ExportVisitor(this.componentsIterator)
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
   * We need to deal with the possibility of multiple components existing in the
   * same container at the same depth, ex: 2 BlockQuotes inside the same
   * Accordion item.
   *
   * If there are several components found, we need a differenciator that
   * will be used to scope all the steps' selectors (which must be run for
   * each instance).
   */
  async preprocess (component) {
    const selector = component.getSelector()
    const matchCount = await dom.getCount(this.pageWorker.page, selector)

    if (matchCount < 2) {
      return
    }

    // Debug.
    console.log(`preprocess() - ${matchCount} matches for lv.${component.getDepth()} ${component.getName()} (${component.constructor.name}) <- ${component.getAncestorsChain()}`)
    console.log(`  selector : ${component.getSelector()}`)

    this.componentsCollection.remove(component)

    const classes = await this.differenciate(
      selector,
      `lv${component.getDepth()}-${component.getName()}`
    )

    if (!classes.length) {
      return
    }

    const container = component.getParentComponent()

    for (let i = 0; i < classes.length; i++) {
      const config = { ...component.config }

      config.selector = '.' + classes[i]
      config.component = container

      if ('select' in config) {
        delete config.select
      }

      const newComponent = await this.iterableFactory({
        type: 'component',
        config
      })

      // Debug.
      // const newComponentSelectorMatchCount = await dom.getCount(this.pageWorker.page, newComponent.getSelector())
      // console.log(`  ${newComponentSelectorMatchCount} for ${classes[i]}`)
      console.log(`    new selector : ${newComponent.getSelector()}`)

      container.add(newComponent)
      this.componentsCollection.add(newComponent)

      // Redo same process as init().
      if (Array.isArray(config.extract)) {
        for (let j = 0; j < config.extract.length; j++) {
          const subExtractionConfig = config.extract[j]
          subExtractionConfig.parent = config
          subExtractionConfig.component = newComponent || container
          const step = await this.iterableFactory({
            type: 'step',
            config: subExtractionConfig,
            newComponent
          })
          if (this.isRecursive && component.getDepth() < this.main.getSetting('maxExtractionNestingDepth')) {
            await this.nestExtractionConfig(subExtractionConfig, component.getDepth(), step)
          }
        }
      } else {
        const step = await this.iterableFactory({
          type: 'step',
          config,
          newComponent
        })
        if (this.isRecursive && component.getDepth() < this.main.getSetting('maxExtractionNestingDepth')) {
          await this.nestExtractionConfig(config, component.getDepth(), step)
        }
      }
    }

    // Now, for all the steps previously set to process the old instance
    // that was replaced by our new components, we need to remove them and
    // replace them with as many steps as previously set during init() - for
    // each new components.
    this.stepsIterator.traverse(step => {
      if (step.getComponent() === component) {
        this.stepsCollection.remove(step)
      }
    })
  }

  /**
   * Returns an array of generated classes added to all elements matched by
   * given selector.
   */
  async differenciate (selector, prefix) {
    this.markedElementsCount++
    const hash = this.hashids.encode(this.markedElementsCount)

    return await dom.evaluate(
      this.pageWorker.page,
      (selector, prefix, hash, alreadyDifferenciatedClass) => {
        const classes = []
        const matches = [...document.querySelectorAll(selector)]

        matches.map((e, i) => {
          if (e.classList.contains(alreadyDifferenciatedClass)) {
            // Debug.
            console.log(`  ${i} already diffed <${e.tagName.toLowerCase()} class="${[...e.classList].join(' ')}">`)

            return
          }
          classes.push(`${prefix}-${i}-${hash}`)
          e.classList.add(`${prefix}-${i}-${hash}`)
          e.classList.add(alreadyDifferenciatedClass)

          // Debug.
          console.log(`  ${i} <${e.tagName.toLowerCase()} class="${[...e.classList].join(' ')}">`)
        })

        return classes
      },
      selector,
      prefix,
      hash,
      this.alreadyDifferenciatedClass
      // `${prefix}--${this.alreadyDifferenciatedClass}`
    )
  }

  /**
   * Processes an extraction "step".
   *
   * This is idempotent : the same step will only get processed once, even if
   * the method is called more than once for the same step.
   */
  async process (step) {
    if (step.isProcessed()) {
      // Debug.
      console.log(`Skip process(${step.extract}) lv.${step.getDepth()} ${step.getComponent().getName()}.${step.getField()}`)
      console.log('  (step is already processed)')

      return
    }
    step.processed = true

    let values = null
    const component = step.getComponent()
    const field = step.getField()

    this.selectorsExtracted.push(step.getSelector())

    // In order to avoid risking extracting the same values more than once (e.g.
    // nested components selected with descendant selectors), we must append
    // the exclusion class to all selectors.
    const selector = step.getSelector() + `:not(.${this.alreadyExtractedClass})`

    // Debug.
    // console.log(`process(${step.extract}) lv.${step.getDepth()} ${component.getName()}.${step.getField()}`)
    // console.log(`  ${step.getSelector()}`)
    // step.locate()

    // Debug.
    // const selectorExists = step.selectorExists(selector)
    // if (!selectorExists) {
    //   console.log(`TODO confirm : selector "${selector}" might be already extracted.`)
    // }

    // "Normal" extraction deals with field or prop values like plain text,
    // markup, attributes, or customized elements extraction process using event
    // (i.e. 'emit' config key).
    if (!step.fieldIsNestedContainer()) {
      values = await this.extract(step, selector)
    } else {
      // When the 'extract' value is a container type, the component has to be
      // an instance of a composite Container (with children).
      if (component.constructor.name !== 'Container') {
        throw Error("Can't process a 'container' extraction type when the component is not a Container itself.")
      }

      // Debug.
      // if (step.isMultiField()) {
      //   console.log(`process(${step.extract}) lv.${step.getDepth()} for ${component.getName()}.${step.getMultiFieldName()}[${step.getMultiFieldNestedContainerPropIndexes()}].${step.getField()}`)
      // } else {
      //   console.log(`process(${step.extract}) lv.${step.getDepth()} for ${component.getName()}.${step.getField()}`)
      // }
      // console.log(`  children.length = ${component.getChildren().length}`)

      const children = component.getChildren()
        .filter(child => JSON.stringify(child.getExtractionResult()) !== '{}')

      // Nothing to set when there are no children.
      if (!children.length) {
        // Debug.
        // console.log(`  No children for component ${component.getName()}`)
        // console.log(`  -> fallback ? '${step.getConf('fallback')}'`)

        if (step.getConf('fallback')) {
          await this.processFallback(step, selector)
        }

        return
      }

      // Debug.
      // for (let i = 0; i < children.length; i++) {
      //   const child = children[i]
      //   console.log(`    child ${i} = ${child.getName()} = ${JSON.stringify(child.getExtractionResult())}`)
      //   console.log(`    child ${i} = ${child.getName()} (keys : ${Object.keys(child.getExtractionResult())})`)
      // }

      values = children.map(child => {
        return { c: child.getName(), props: child.getExtractionResult() }
      })

      // Attach a unique ID to be able to determine where they belong, i.e.
      // multi-field items or nested containers.
      // component.setComponentID()
      // children.forEach(child => {
      //   child.setComponentID(component.getComponentID())
      // })

      // Debug.
      console.log(`process(${step.extract}) lv.${step.getDepth()} for ${component.getName()}.${step.getMultiFieldName()}[].${step.getField()}`)
      // console.log(`  ${component.getComponentID()} / ${component.getSelector()}`)
      // console.log(`  ${component.getSelector()}`)
      console.log(`  children = ${children.map(child => `lv.${child.getDepth()} ${child.getName()}`).join(', ')}`)
    }

    // Mark matched selector as extracted to avoid risking extracting the same
    // values more than once (e.g. nested components selected with descendant
    // selectors).
    // This relies on the fact that process() runs first on deepest nesting
    // levels.
    await dom.addClass(this.pageWorker.page, selector, this.alreadyExtractedClass)

    // Values may still be null at this point.
    if (!values) {
      if (step.getConf('fallback')) {
        await this.processFallback(step, selector)
      }
      return
    }

    // Deal with multi-fields groups, e.g. :
    //   - component.MediaGrid.items[].image
    //   - component.MediaGrid.items[].title
    //   - component.MediaGrid.items[].text
    if (step.isMultiField()) {
      await component.setMultiFieldValues(step, values)
    } else {
      // Otherwise, set as "normal" component field value.
      component.setField(field, values)
    }
  }

  /**
   * Processes the fallback extraction config when process didn't produce any
   * result.
   *
   * @param {Step} step Step instance
   * @param {string} selector
   */
  async processFallback (step, selector) {
    const component = step.getComponent()

    if (!step.isMultiField()) {
      const fallbackStep = await this.createFallbackStep(step.config, component)
      if (!fallbackStep) {
        return
      }
      await this.process(fallbackStep)
    } else {
      // Debug.
      // console.log(`Fallback for multiField step of lv.${step.getDepth()} for ${component.getName()}.${step.getField()}`)

      const multiFieldItems = component.getMultiFieldItems(step)

      if (multiFieldItems && multiFieldItems.length) {
        for (let i = 0; i < multiFieldItems.length; i++) {
          const item = multiFieldItems[i]

          if (!(step.getField() in item)) {
            // Debug.
            // console.log(`processFallback() - ${component.getName()} '${step.getMultiFieldName()}[${i}].${step.getField()}' (${step.extract}) :`)
            // console.log(`  item ${i} is missing prop '${step.getField()}'`)

            const fallbackStep = await this.createFallbackStep(step.config, component)
            if (!fallbackStep) {
              continue
            }

            // Debug.
            // console.log(`mf '${step.getMultiFieldName()}.${step.getField()}' (${step.extract} as ${step.as})`)
            // console.log(`    '${fallbackStep.getMultiFieldName()}.${fallbackStep.getField()}' (${fallbackStep.extract} as ${fallbackStep.as})`)
            // console.log(`    fallbackStep keys : ${Object.keys(fallbackStep)}`)
            // fallbackStep.locate('fallbackStep :')

            await this.process(fallbackStep)
          }
        }
      }
    }
  }

  /**
   * Returns extracted value(s) for a field or prop (represented by given Step
   * instance).
   *
   * @param {Step} step instance representing the extraction details of a single
   *   field or prop.
   * @param {string} selector already scoped and transformed in
   *   iterableFactory() and process().
   */
  async extract (step, selector) {
    let values = null

    switch (step.extract) {
      case 'text':
        values = await dom.text(
          this.pageWorker.page,
          selector,
          this.main.getSetting('plainTextRemoveBreaks')
        )
        break
      case 'text_single':
        values = await dom.textSingle(
          this.pageWorker.page,
          selector,
          this.main.getSetting('plainTextRemoveBreaks'),
          this.main.getSetting('plainTextSeparator')
        )
        break
      case 'markup':
        values = await dom.markup(
          this.pageWorker.page,
          selector,
          this.main.getSetting('minifyExtractedHtml')
        )
        break
      case 'attribute': {
        const attribute = step.getConf('attribute')
        if (!attribute) {
          step.locate('Error:')
          throw Error(`Missing attribute for extracting ${step.as}.`)
        }
        values = await dom.attribute(
          this.pageWorker.page,
          selector,
          attribute
        )
        break
      }
      case 'element': {
        const event = step.getConf('emit')
        if (!event) {
          step.locate('Error:')
          throw Error(`Missing event for extracting ${step.as}.`)
        }
        // The "context" is an object which must be altered by the event
        // listeners.
        const context = { step, selector }
        const hadListeners = this.main.emit(event, context)
        if (!hadListeners) {
          step.locate('Error:')
          throw Error(`Event '${event}' requires at least 1 listener for extracting ${step.as}.`)
        }
        // There are 2 possibilities when extraction config is set to 'element':
        // 1. The event listener(s) returns values (which would be the result of
        // an entirely custom extraction process),
        // 2. The event listeners return a callback function and (optionally)
        // a list of arguments, which will be run inside the headless browser,
        // and which must return the values.
        if ('values' in context) {
          values = context.values
        } else if (context.callback) {
          if (context.args) {
            values = await dom.element(this.pageWorker.page, selector, context.callback, ...context.args)
          } else {
            values = await dom.element(this.pageWorker.page, selector, context.callback)
          }
        }
        break
      }
    }

    // Debug.
    // const component = step.getComponent()
    // if (component.getName() === 'BlockQuote') {
    //   console.log(`extract() lv.${step.getDepth()} ${component.getName()}.${step.getField()} (${component.constructor.name}) <- ${component.getAncestorsChain()}`)
    //   console.log(`  selector = ${selector}`)
    //   console.log(`  values = ${values}`)
    // }

    // if (values && values.length) {
    return values
    // }

    // Provide opportunities to look for other elements in case no values were
    // found.
    // await this.processFallback(step, selector)
  }
}

module.exports = Extractor
