
/**
 * Defines a queue of items (operations) keyed by string (url).
 */
class Queue {
  constructor () {
    this.items = {}
  }

  addItem (key, item) {
    if (!(key in this.items)) {
      this.items[key] = []
    }
    this.items[key].push(item)
  }

  removeItem (key, i) {
    if (!(key in this.items) || !this.items[key].length) {
      return
    }
    return this.items[key].splice(i, 1)
  }

  getItem (key) {
    if (!(key in this.items) || !this.items[key].length) {
      return
    }
    return this.items[key].shift()
  }

  getItemsCount (key) {
    return this.items[key].length
  }

  getKeys () {
    return Object.keys(this.items)
  }

  getKeysCount () {
    return this.getKeys().length
  }

  getNextKey () {
    const keys = this.getKeys()
    if (keys.length) {
      for (let i = 0; i < keys.length; i++) {
        if (this.getItemsCount(keys[i])) {
          return keys[i]
        }
      }
    }
  }
}

module.exports = Queue
