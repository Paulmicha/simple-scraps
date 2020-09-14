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
    this.ancestors = []
  }

  setAncestors (ancestors) {
    this.ancestors = ancestors
  }

  /**
   * Always set depth level to 0 if instance has a single ancestor (the page
   * document root).
   *
   * @param {Number} depth (optional) Overrides the default process.
   */
  setDepth (depth) {
    if (depth) {
      this.depth = depth
      return
    }
    if (this.ancestors.length) {
      this.depth = this.ancestors.length - 1
      return
    }
    this.depth = 0
  }

  getDepth () {
    return this.depth
  }

  setScope (scope) {
    this.scope = scope
  }

  getScope () {
    return this.scope
  }
}

module.exports = Iterable
