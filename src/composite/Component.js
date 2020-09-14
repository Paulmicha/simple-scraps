const Iterable = require('./Iterable')

/**
 * Chain of responsability pattern : base handler.
 *
 * Represents anything that can be extracted from the DOM tree corresponding to
 * a single (CSS) selector, which can match multiple elements.
 *
 * @see src/composite/Container.js
 * @see src/composite/Leaf.js
 */
class Component extends Iterable {
  constructor (selector, container) {
    super()
    this.container = container
    this.extracted = {}
  }

  getParent () {
    return this.container
  }

  setField (prop, value) {
    this.extracted[prop] = value
  }

  getExtractionResult () {
    return this.extracted
  }
}

module.exports = Component
