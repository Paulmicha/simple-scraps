const Component = require('./Component')

/**
 * Composite container.
 *
 * Represents a type of component that can contain other components.
 */
class Container extends Component {
  constructor (extractor, config) {
    super(extractor, config)
    this.children = []
  }

  add (child) {
    this.children.push(child)
  }

  getChildren () {
    return this.children
  }

  accept (visitor) {
    visitor.visitContainer(this)
  }
}

module.exports = Container
