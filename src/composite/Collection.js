const Iterator = require('./Iterator')

/**
 * Composite store containing Iterable instances (items).
 *
 * @see src/composite/Iterator.js
 * @see src/composite/Iterable.js (-> Step, Component -> Container, Leaf)
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

  remove (item) {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i] === item) {
        this.items.splice(i, 1)
      }
    }
  }

  count () {
    return this.items.length
  }
}

module.exports = Collection
