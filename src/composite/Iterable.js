const dom = require('../utils/dom')

/**
 * Base class of all Collection items (traversable and sortable via Iterator).
 *
 * @see src/composite/Step.js
 * @see src/composite/Component.js (-> Container, Leaf)
 */
class Iterable {
  constructor (extractor, config) {
    this.extractor = extractor

    this.depth = 0
    this.ancestors = null
    this.ancestorsChain = ''

    this.selector = config.selector
    this.extract = config.extract
    this.as = config.as
    this.parentStep = config.parentStep

    // After all, go ahead and store the whole extraction configuration for
    // cases like attribute extraction, which require an additional value.
    // This allows any arbitrary values to be retrieved from confg during the
    // extraction process.
    // @see getConf()
    // @see Extractor.process()
    this.config = config
  }

  /**
   * Specifies the location in the composite tree (Collection).
   *
   * @param {Iterable} parentComponent the parent Iterable instance.
   */
  setParentComponent (parentComponent) {
    // Debug.
    // if (this.constructor.name !== 'Step') {
    //   console.log(`setParentComponent() of ${this.getName()} (${this.constructor.name})`)
    //   console.log(`  -> ${parentComponent.getName()} (${parentComponent.constructor.name})`)
    //   const debugAncestorsChain = parentComponent.getAncestorsChain()
    //   if (debugAncestorsChain) {
    //     console.log(`    ${parentComponent.getAncestorsChain()}`)
    //   }
    // }

    this.parentComponent = parentComponent
  }

  getParentComponent () {
    return this.parentComponent
  }

  /**
   * Base ancestors + ancestorsChain props setter.
   */
  setAncestors () {
    this.ancestors = this.getAncestors()

    if (this.ancestors && this.ancestors.length) {
      this.ancestorsChain = this.ancestors
        .map(e => e.getName())
        .join(' <- ')
    }

    this.setDepth()
  }

  /**
   * Returns an array of components representing the "nesting chain".
   *
   * Starts from current depth level and ends with the page document root
   * (i.e. the single Container of depth 0 shared by all components).
   */
  getAncestors () {
    // Memoization.
    if (this.ancestors) {
      return this.ancestors
    }

    const ancestors = []

    const loopThroughAncestors = (current) => {
      const parent = current.getParentComponent()
      if (parent) {
        ancestors.push(parent)
        loopThroughAncestors(parent)
      }
    }

    loopThroughAncestors(this)

    // Debug.
    // console.log(`getAncestors() for ${this.constructor.name} '${this.extract}' as ${this.as}`)
    // console.log(ancestors.map(a => a.locate('')))
    // if (this.constructor.name !== 'Step') {
    //   console.log(`getAncestors() of ${this.getName()} (${this.constructor.name})`)
    //   if (!ancestors.length) {
    //     console.log(`Warning : no ancestors at lv.${this.getDepth()}`)
    //   } else {
    //     console.log(ancestors.map(a => `${a.getName()} (${a.constructor.name})`))
    //   }
    // }

    return ancestors
  }

  getAncestorsChain () {
    return this.ancestorsChain
  }

  /**
   * Sets the depth level corresponding to components nesting (ancestors).
   *
   * @param {Number} depth (optional) Allows overriding this method's result.
   */
  setDepth (depth) {
    if (depth) {
      this.depth = depth
      return
    }

    const ancestors = this.getAncestors()

    if (ancestors.length) {
      this.depth = ancestors.length
      return
    }

    this.depth = 0
  }

  getDepth () {
    return this.depth
  }

  /**
   * Scope and customize lookup selectors.
   *
   * Allows jQuery-like selector syntax if there is a DOM Query Helper available
   * in browsed page(s).
   * @see Page.addDomQueryHelper()
   *
   * Examples of jQuery-like syntax :
   *   1. Set a custom class on parent element and use it as new scope :
   *     "selector": "$.makeArray($('.nav-tabs')).map(e => e.parentElement)"
   *       TODO parse alternative simplified syntax ? e.g. :
   *         "selector": ".nav-tabs.parents()"
   *   2. Idem, but using closest() to set scope in any ancestor (stops at
   *     closest match) :
   *     "selector": "$.makeArray($('.nav-tabs')).map(e => $(e).closest(section)[0])"
   *       TODO parse alternative simplified syntax ? e.g. :
   *         "selector": ".nav-tabs.closests(section)"
   *   3. Going up then down the DOM tree :
   *     "selector": "$.makeArray($('.nav-tabs')).map(e => $(e).closest(section).find(.something)[0])"
   *       TODO parse alternative simplified syntax ? e.g. :
   *         "selector": ".nav-tabs.closests(section).descendants(.something)"
   *
   * @param {string} selector (optional) Allows overriding this method's result.
   */
  async scopeSelector (selector) {
    if (selector) {
      this.setSelector(selector)
    }

    // Detect + convert jQuery-like syntax to normal CSS selectors by adding
    // custom classes on matched elements.
    // TODO support another key for vanilla JS, e.g. :
    // "evaluate": "Array.from(document.querySelectorAll('.nav-tabs')).map(e => e.parentElement)"
    if (this.selector.includes('$')) {
      if (!this.extractor.main.getSetting('addDomQueryHelper')) {
        this.locate('Error:')
        throw Error("The selector uses a syntax requiring the setting 'addDomQueryHelper', which is not enabled.")
      }

      this.extractor.markedElementsCount++
      const markerClass = `js-scraps-${this.extractor.hashids.encode(this.extractor.markedElementsCount)}`

      /* istanbul ignore next */
      await dom.evaluate(
        this.extractor.pageWorker.page,
        (strToEval, markerClass) => {
          const items = eval(strToEval)
          items.map(e => e.classList.add(markerClass))
        },
        this.selector,
        markerClass
      )

      // Debug.
      // const markup = await dom.markup(this.extractor.pageWorker.page, `.${markerClass}`)
      // console.log('markup :')
      // console.log(markup)

      this.setSelector(`.${markerClass}`)
    }

    if (selector) {
      return
    }

    const parentComponent = this.getParentComponent()

    if (parentComponent && parentComponent.selector) {
      if (parentComponent.selector.length && parentComponent.selector !== ':root') {
        this.setSelector(`${parentComponent.getSelector()} ${this.getSelector()}`)
      }
    }

    // When config.parentStep is set, it means we are in a recursive call via a
    // field or prop containing components.
    // The selector scoping relies on Component ancestors chain, but their
    // selectors will not have any trace of the containing field selector, if it
    // is set.
    // This can break nested components lookups if we have someting like :
    // 'body > main' in the 1st depth level -> Apply only for 1st depth level.
    if (this.constructor.name !== 'Step' && this.parentStep && this.getDepth() === 1) {
      this.setSelector(`${this.parentStep.getSelector()} ${this.getSelector()}`)
    }
  }

  setSelector (selector) {
    this.selector = selector
  }

  getSelector () {
    return this.selector
  }

  async selectorExists () {
    const selector = this.getSelector()

    // Memoization.
    if (Object.keys(this.extractor.selectorExists).includes(selector)) {
      return this.extractor.selectorExists[selector]
    }

    this.extractor.selectorExists[selector] = await dom.exists(
      this.extractor.pageWorker.page,
      selector,
      this.extractor.main.getSetting('selectorExistsTimeout')
    )

    return this.extractor.selectorExists[selector]
  }

  /**
   * Retrieves any extraction configuration value (by key).
   */
  getConf (key) {
    if (key in this.config) {
      return this.config[key]
    }
  }

  /**
   * Debug utility : logs in console clues to situate this collection item.
   */
  locate (prefix) {
    if (!prefix) {
      prefix = ''
    }

    const depth = this.getDepth()
    const debugIndent = prefix + '  '.repeat(depth)

    let stringifiedExtract = this.extract
    if (Array.isArray(this.extract)) {
      stringifiedExtract = this.extract.map(e => e.as).join(', ')
    }

    if (this.constructor.name !== 'Step') {
      console.log(`${debugIndent}lv.${depth} ${this.getName()} (${this.constructor.name}) <- ${this.getAncestorsChain()}`)
    } else {
      console.log(`${debugIndent}lv.${depth} Step : prop '${this.getField()}' (${stringifiedExtract})`)
      this.getComponent().locate(debugIndent + 'of :')
    }

    if (this.selector) {
      console.log(`${debugIndent}  ( ${this.selector} )`)
    }
  }
}

module.exports = Iterable
