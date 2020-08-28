
/**
 * Defines a queue of items keyed by string.
 *
 * Used to handle operations by URL.
 */
class Queue {
  constructor () {
    this.items = {}
    this.emptyKeys = []
  }

  addItem (key, item) {
    if (!(key in this.items)) {
      this.items[key] = []
    }
    this.items[key].push(item)
    const i = this.emptyKeys.indexOf(key)
    if (i !== -1) {
      this.emptyKeys.splice(i, 1)
    }
  }

  getItem (key) {
    if (!this.getItemsCount(key)) {
      return
    }
    return this.items[key].shift()
  }

  getItemsCount (key) {
    if (!(key in this.items)) {
      return 0
    }
    return this.items[key].length
  }

  flushEmptyKeys () {
    const keys = Object.keys(this.items)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (this.getItemsCount(key) < 1) {
        this.emptyKeys.push(key)
        delete this.items[key]
      }
    }
  }

  getKeys () {
    this.flushEmptyKeys()
    return Object.keys(this.items)
  }

  getKeysCount () {
    return this.getKeys().length
  }

  getNextKey (offset) {
    const keys = this.getKeys()
    if (keys.length) {
      for (let i = 0; i < keys.length; i++) {
        if (offset && i < offset) {
          continue
        }
        if (this.getItemsCount(keys[i])) {
          return keys[i]
        }
      }
    }
  }
}

module.exports = Queue
