
/**
 * Generic utility to traverse collections (trees).
 */
class Iterator {
  constructor (collection) {
    this.cursor = 0
    this.collection = collection
  }

  next () {
    if (this.hasMore()) {
      const item = this.collection.items[this.cursor]
      this.cursor++
      return item
    }
  }

  hasMore () {
    const count = this.collection.count()
    return count > 0 && this.cursor < count
  }

  reset () {
    this.cursor = 0
  }
}

module.exports = Iterator
