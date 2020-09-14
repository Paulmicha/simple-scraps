
/**
 * Composite collection item wrapping extraction configs and components.
 *
 * This is necessary because multiple extraction steps may run for extracting
 * a single component (which can have multiple fields - each requiring a
 * distinct selector, thus a distinct extraction step).
 *
 * Each instance of this class represents a single extraction step which will
 * be exectued in Extractor.process() method.
 */
class Step {
  constructor (config, main) {
    this.component = config.component
    this.selector = config.selector
    this.extract = config.extract
    this.as = config.as
    this.emit = config.emit
    this.parent = config.parent
    this.main = main

    // This will be reset in Extractor.setNestedExtractionConfig().
    this.ancestors = config.ancestors

    // This will be reset in this.preprocess().
    this.depth = 0
  }

  getParent () {
    return this.parent
  }

  getComponent () {
    return this.component
  }

  getField () {
    const destination = this.as.split('.')
    if (destination.length > 2) {
      return destination[2]
    }
    return destination[1]
  }

  // setAncestors (ancestors) {
  //   this.ancestors = ancestors
  // }

  setDescendants (descendants) {
    this.descendants = descendants
  }

  /**
   * Preprocesses extraction step before running the actual process.
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
   */
  preprocess () {
    let ancestorsChain = ''

    if (!this.ancestors) {
      this.ancestors = []
    }

    if (this.parent) {
      ancestorsChain = this.ancestors.map(e => e.as).join(' <- ') + ' <- '

      // Assign a scope for current config, and prepend selector for ensuring
      // correct nesting.
      if (this.parent.selector) {
        this.scope = this.parent.selector
        this.selector = `${this.parent.selector} ${this.selector}`
      }
    }

    this.depth = this.ancestors.length
    this.ancestorsChain = ancestorsChain + this.as

    // Call any custom 'preprocess' implementations.
    if ('preprocess' in this) {
      this.main.emit(this.preprocess, this)
    }

    // Debug.
    const debugIndent = '  '.repeat(this.depth)
    console.log(`${debugIndent}depth ${this.depth} : ${this.ancestorsChain}`)
    console.log(`${debugIndent}  ( ${this.selector} )`)
    if (this.fieldOverride) {
      console.log(`${debugIndent}  as ${this.fieldOverride}`)
    }

    // Detect + convert jQuery-like syntax to normal CSS selectors (injects custom
    // classes).
    // if (this.main.getSetting('addDomQueryHelper')) {
    // }
  }
}

module.exports = Step
