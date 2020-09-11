
/**
 * Generic utility to traverse collections (trees).
 */
class Iterator {
  constructor (collection) {
    this.cursor = -1
    this.collection = collection
  }

  next () {
    if (this.hasMore()) {
      this.cursor++
      return this.collection.items[this.cursor]
    }
  }

  hasMore () {
    const count = this.collection.count()
    return count > 0 && (this.cursor === -1 || count < this.cursor)
  }

  reset () {
    this.cursor = -1
  }
}

module.exports = Iterator
