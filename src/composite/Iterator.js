
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

  cycle (callback) {
    while (this.hasMore()) {
      callback(this.next())
    }
    this.reset()
  }

  async cycleAsync (callback) {
    while (this.hasMore()) {
      await callback(this.next())
    }
    this.reset()
  }
}

module.exports = Iterator
