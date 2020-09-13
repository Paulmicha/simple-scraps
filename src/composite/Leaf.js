const Component = require('./Component')

/**
 * Composite leaf.
 *
 * Represents a component that has no children.
 */
class Leaf extends Component {
  // TODO [wip]
  // constructor (container) {
  //   super(container)
  // }

  accept (visitor) {
    visitor.visitLeaf(this)
  }
}

module.exports = Leaf
