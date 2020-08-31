
/**
 * Binds multiple extractors' result in a single object representing an entity
 * or a "fragment" of entity for nested object structures.
 */
class Entity {
  constructor (type, bundle) {
    this.type = type
    this.bundle = bundle
    this.object = {}
  }

  get (field) {
    if (!field) {
      return this.object
    }
    return this.object[field]
  }

  set (field, value) {
    this.object[field] = value
  }

  getKeys () {
    return Object.keys(this.object)
  }

  export () {
    return JSON.stringify(this.object)
  }
}

module.exports = Entity
