
/**
 * Composite store.
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
