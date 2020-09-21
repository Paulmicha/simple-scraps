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
    this.selectorAlreadyExtracted = {}

    // In order to support selectors using jQuery-like syntax, we need a unique
    // counter for hash IDs to track custom classes added to the page elements
    // that need to be "marked".
    this.markedElementsCount = 0
    this.hashids = new Hashids('SimpleScraps', 10)

    // This class is used to avoid
    this.alreadyExtractedClass = 'is-already-extracted-' + this.hashids.encode(1)

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
    this.steps = new Collection()
    this.iterator = this.steps.createIterator()
    this.extracted = new Collection()
    this.extractedIterator = this.extracted.createIterator()

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
    this.extracted.add(this.rootComponent)
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
    if (newComponent) {
      config.component = newComponent
    }

    if (!config.component) {
      throw Error('Missing component in iterableFactory()')
    }

    // Ne need to instanciate anything if we're inside a scope which doesn't
    // match any element in the page.
    const scopeExists = await config.component.selectorExists()
    if (!scopeExists) {
      return
    }

    switch (type) {
      case 'step': {
        instance = new Step(this, config)

        // Set parent / ancestors scope.
        instance.setParentComponent(config.component)

        // Scope the selector.
        instance.setAncestors()
        await instance.scopeSelector()

        // Debug.
        // console.log(`iterableFactory(${type})`)
        // instance.locate('  ')

        // If nothing matches scoped selector, do not add it to the collection.
        if (await instance.selectorExists()) {
          this.steps.add(instance)
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
        // console.log(`iterableFactory(${type}) : ${instance.getName()}`)
        // instance.locate('  ')

        // If nothing matches scoped selector, do not add it to the collection.
        if (await instance.selectorExists()) {
          this.extracted.add(instance)
        }
        break
      }
    }

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
      // console.log(`isContainer(${config.extract}) ? -> ${this.main.getSetting('extractionContainerTypes').includes(config.extract)}`)

      return this.main.getSetting('extractionContainerTypes').includes(config.extract)
    }
    return false
  }

  /**
   * Populates the composite collection based on extraction configs.
   *
   * We need to obtain instances of composite Component classes (Leaf and
   * Container) to represent what will be extracted (in as many steps as there
   * are selectors to run - i.e. one step per Component field or prop) :
   *
   *   1. Single fields or properties of the main entity being extracted
   *     (because 1 Extractor works on 1 open page = 1 resulting object)
   *   2. Groups of multiple fields or properties (e.g. a component)
   *   3. Nested components as field or property value (either of the page being
   *     extracted or of one of its components)
   *
   * If a config 'extract' key is not an array and has a destination ('as' key)
   * corresponding to a component, we assume that the component is to be
   * extracted as a single prop component (contained in the parent config
   * component).
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
        (destination.length === 2 || config.component.getName() !== destination[1])) {
        newComponent = await this.iterableFactory({
          type: 'component',
          container,
          config
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
            config: subExtractionConfig
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

    // Debug.
    console.log(`run() ${this.steps.count()} selectors, ${this.extracted.count()} components.`)
    // console.log(`  this.selectorExists = ${JSON.stringify(this.selectorExists, null, 2)}`)

    // Debug.
    // console.log('Before sorting :')
    // this.iterator.traverse(step => step.locate())

    // 2. Sort the extraction steps to start from deepest levels.
    this.iterator.sort()

    // Debug.
    // console.log('After sorting :')
    // this.iterator.traverse(step => step.locate())

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
   * Processes an extraction "step".
   */
  async process (step) {
    let values = null
    const component = step.getComponent()
    const field = step.getField()

    // In order to avoid risking extracting the same values more than once (e.g.
    // nested components selected with descendant selectors), we must append
    // the exclusion class to all selectors.
    const selector = step.getSelector() + `:not(${this.alreadyExtractedClass})`

    // Debug.
    // console.log(`process() ${field} for ${step.as}`)
    // console.log(`  ${selector}`)
    // console.log(`  extracting ${step.extract}`)
    console.log(`process(${step.extract}) '${field}' of lv.${component.getDepth()} ${component.getName()}`)
    // step.locate()

    // Debug.
    const selectorExists = step.selectorExists()
    if (!selectorExists) {
      console.log(`  !! selector ${selector} does not match anything`)
    }

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
        const context = {}
        const hadListeners = this.main.emit(event, step, context)
        if (!hadListeners) {
          step.locate('Error:')
          throw Error(`Event '${event}' requires at least 1 listener for extracting ${step.as}.`)
        }
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

    // When the 'extract' value is a container type, the component has to be
    // an instance of a composite Container (with children).
    if (this.main.getSetting('extractionContainerTypes').includes(step.extract)) {
      if (component.constructor.name !== 'Container') {
        throw Error("Can't process a 'container' extraction type when the component is not a Container itself.")
      }

      const children = component.getChildren()
        .filter(child => JSON.stringify(child.extracted) !== '{}')

      // Nothing to set when there are no children.
      if (!children.length) {
        return
      }

      // Debug.
      // console.log(`  Children of lv.${component.getDepth()} ${component.getName()} :`)
      // children.forEach(child => {
      //   child.locate('    child :')
      //   console.log(`    child.extracted = ${JSON.stringify(child.extracted)}`)
      // })

      values = children.map(child => {
        return { c: child.getName(), props: child.extracted }
      })
    }

    // Mark matched selector as extracted to avoid risking extracting the same
    // values more than once (e.g. nested components selected with descendant
    // selectors).
    await dom.addClass(this.pageWorker.page, selector, this.alreadyExtractedClass)

    // Deal with multi-fields groups, e.g. :
    //   - component.MediaGrid.items[].image
    //   - component.MediaGrid.items[].title
    //   - component.MediaGrid.items[].text
    if (step.isMultiField()) {
      component.setMultiFieldValues(step, values)
      component.setField(step.getMultiFieldName(), component.getMultiFieldItems(step))
    } else {
      // Otherwise, set as "normal" component field value.
      component.setField(field, values)
    }
  }
}

module.exports = Extractor
