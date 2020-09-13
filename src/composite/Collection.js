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
    this.iterator = new Iterator(this)
    return this.iterator
  }

  add (item) {
    this.items.push(item)
  }

  count () {
    return this.items.length
  }

  cycle (callback) {
    while (this.iterator.hasMore()) {
      callback(this.iterator.next())
    }
    this.iterator.reset()
  }

  async cycleAsync (callback) {
    while (this.iterator.hasMore()) {
      await callback(this.iterator.next())
    }
    this.iterator.reset()
  }
}

module.exports = Collection
