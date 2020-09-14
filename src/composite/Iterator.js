const { compare } = require('specificity')

/**
 * Traverses and sorts (tree) Collection of Step instances.
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

  /**
   * Sorts collection items (= Step instances) by most deeply nested, then CSS
   * selectors specificity in case of equality.
   */
  sort () {
    if (this.collection.items.length <= 1) {
      return
    }
    this.collection.items.sort((a, b) => {
      // 'a' is less specific than 'b' (= less deeply nested).
      if (a.depth < b.depth) {
        return -1
      }
      // 'a' is more specific than 'b' (= nested deeper).
      if (a.depth > b.depth) {
        return 1
      }
      // Equality leads to CSS selectors specificity comparison.
      if (a.depth === b.depth) {
        return compare(a.selector, b.selector)
      }
    })
  }
}

module.exports = Iterator
