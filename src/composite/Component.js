
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
  }

  getParent () {
    return this.container
  }
}

module.exports = Component
