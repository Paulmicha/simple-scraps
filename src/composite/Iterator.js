const { compare } = require('specificity')

/**
 * Traverses and sorts (tree) Collection of Iterable instances.
 *
 * @see src/composite/Collection.js
 * @see src/composite/Iterable.js (-> Step, Component -> Container, Leaf)
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

  traverse (callback) {
    while (this.hasMore()) {
      callback(this.next())
    }
    this.reset()
  }

  async traverseAsync (callback) {
    while (this.hasMore()) {
      await callback(this.next())
    }
    this.reset()
  }

  /**
   * Sorts collection items (= Iterable instances) by most deeply nested, then
   * CSS selectors specificity in case of equality.
   */
  sort () {
    if (this.collection.items.length <= 1) {
      return
    }
    this.collection.items.sort((a, b) => {
      // Debug.
      // console.log(`a.depth = ${a.getDepth()}, b.depth = ${b.getDepth()}`)
      // console.log(`a.ancestorsChain = '${a.ancestorsChain}', b.ancestorsChain = '${b.ancestorsChain}'`)

      // 'a' is less specific than 'b' (= less deeply nested).
      if (a.getDepth() < b.getDepth()) {
        return 1
      }
      // 'a' is more specific than 'b' (= nested deeper).
      if (a.getDepth() > b.getDepth()) {
        return -1
      }

      // Debug.
      // console.log(`compare(${a.getSelector()}, ${b.getSelector()}) = ${compare(a.getSelector(), b.getSelector())}`)

      // Fallback : equality leads to CSS selectors specificity comparison.
      return compare(a.getSelector(), b.getSelector()) * -1
    })
  }
}

module.exports = Iterator
