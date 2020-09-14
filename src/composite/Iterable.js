/**
 * Defines a common base for sortable Collection items (via Iterator).
 *
 * @see src/composite/Step.js
 * @see src/composite/Component.js (-> Container, Leaf)
 */
class Iterable {
  constructor () {
    this.depth = 0
    this.scope = ''
  }

  getDepth () {
    return this.depth
  }

  getScope () {
    return this.scope
  }
}

module.exports = Iterable
