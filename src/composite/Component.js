
/**
 * Chain of responsability pattern : base handler.
 *
 * Represents anything that can be extracted from the DOM tree corresponding to
 * a single (CSS) selector, which can match multiple elements.
 */
class Component {
  constructor (selector, container) {
    this.selector = selector
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
