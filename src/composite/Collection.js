const Iterator = require('./Iterator')

/**
 * Composite store.
 *
 * TODO (wip)
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
