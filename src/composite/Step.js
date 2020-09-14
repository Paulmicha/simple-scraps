const Iterable = require('./Iterable')

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
class Step extends Iterable {
  constructor (config, main) {
    super(config)
    this.parent = config.parent
    this.component = config.component
    this.emit = config.emit
    this.main = main
  }

  // setParent (parent) {
  //   this.parent = parent
  // }

  /**
   * Overrides base class method to scope and customize lookup selectors.
   *
   * Allows jQuery-like selector syntax if there is a DOM Query Helper available
   * in browsed page(s).
   * @see Page.addDomQueryHelper()
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
   * @param {string} scope (optional) Allows overriding this method's result.
   */
  setScope (scope) {
    // Detect + convert jQuery-like syntax to normal CSS selectors (injects custom
    // classes).
    // if (this.main.getSetting('addDomQueryHelper')) {
    // }

    if (scope) {
      this.scope = scope
      return
    }

    if (this.parent && this.parent.selector) {
      this.scope = this.parent.selector
      this.selector = `${this.parent.selector} ${this.selector}`
    }
  }

  getField () {
    const destination = this.as.split('.')
    if (destination.length > 2) {
      return destination[2]
    }
    return destination[1]
  }

  getComponent () {
    return this.component
  }
}

module.exports = Step
