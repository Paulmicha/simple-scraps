
/**
 * Defines a queue of operations keyed by url.
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

    // Debug
    console.log(key, item)
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

  getCount (key) {
    return this.items[key].length
  }

  getKeys () {
    return Object.keys(this.items)
  }
}

module.exports = Queue
