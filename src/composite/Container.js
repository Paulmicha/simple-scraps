const Component = require('./Component')

/**
 * Composite container implementing chain of responsability (concrete handler).
 *
 * Represents a type of component that can contain other components.
 */
class Container extends Component {
  constructor (selector, container) {
    super(selector, container)
    this.children = []
  }

  add (child) {
    this.children.push(child)
  }

  getChildren () {
    return this.children
  }
}

module.exports = Container
