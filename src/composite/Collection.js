
/**
 * Composite store.
 *
 * There is nothing fundamentally different than a simple array here, but for
 * clarity's sake, this class explicitly signals the design pattern used.
 */
class Collection {
  constructor () {
    this.items = []
  }

  add (item) {
    this.items.push(item)
  }

  count () {
    return this.items.length
  }

  cycle (iterator, callback) {
    while (iterator.hasMore()) {
      callback(iterator.next())
    }
  }
}

module.exports = Collection
