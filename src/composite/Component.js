
/**
 * Chain of responsability pattern : base handler.
 *
 * Represents anything that can be extracted from the DOM tree.
 */
class Component {
  constructor (container, selector) {
    this.container = container
    this.selector = selector
  }
}

module.exports = Component
