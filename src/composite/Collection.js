const Iterator = require('./Iterator')

/**
 * Composite store containing extraction steps.
 *
 * @see src/composite/Step.js
 */
class Collection {
  constructor () {
    this.items = []
  }

  createIterator () {
    return new Iterator(this)
  }

  add (item) {
    this.items.push(item)
  }

  count () {
    return this.items.length
  }
}

module.exports = Collection
