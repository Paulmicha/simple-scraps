
/**
 * Represents all objects extracted from a page DOM tree.
 */
class Collection {
  constructor (iterator) {
    this.items = []
    this.iterator = iterator
  }

  cycle (callback) {
    while (this.iterator.hasMore()) {
      callback(this.iterator.next())
    }
  }

  count () {
    return this.items.length
  }
}

module.exports = Collection
