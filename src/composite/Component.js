const Iterable = require('./Iterable')

/**
 * Composite element representing a piece of the extraction result.
 *
 * @see src/composite/Container.js
 * @see src/composite/Leaf.js
 */
class Component extends Iterable {
  constructor (config) {
    super(config)
    this.container = config ? config.component : null
    this.extracted = {}
  }

  setContainer (container) {
    this.container = container
  }

  setField (prop, value) {
    this.extracted[prop] = value
  }

  getExtractionResult () {
    return this.extracted
  }
}

module.exports = Component
