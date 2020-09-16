const Iterable = require('./Iterable')

/**
 * Composite element representing a piece of the extraction result.
 *
 * @see src/composite/Container.js
 * @see src/composite/Leaf.js
 */
class Component extends Iterable {
  constructor (extractor, config) {
    super(extractor, config)
    this.container = config ? config.component : null
    this.extracted = {}
  }

  getName () {
    const destination = this.as.split('.')
    return destination[1] || this.as
  }

  setField (prop, value) {
    this.extracted[prop] = value
  }

  getExtractionResult () {
    return this.extracted
  }
}

module.exports = Component
