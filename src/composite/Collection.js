const Iterator = require('./Iterator')

/**
 * Composite store containing Iterable instances (items).
 *
 * @see src/composite/Iterator.js
 * @see src/composite/Iterable.js (-> Step, Component -> Container, Leaf)
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
