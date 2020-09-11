
/**
 * Chain of responsability pattern : base handler.
 *
 * Represents anything that can be extracted from the DOM tree corresponding to
 * a single (CSS) selector, which can match multiple elements.
 */
class Component {
  constructor (container, selector) {
    this.container = container
    this.selector = selector
  }

  getParent () {
    return this.container
  }
}

module.exports = Component
