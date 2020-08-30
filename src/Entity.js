
/**
 * Binds multiple extractors' result in a single object representing an entity.
 */
class Entity {
  constructor (type, bundle) {
    this.type = type
    this.bundle = bundle
  }

  setField (field, value) {
    this[field] = value
  }

  export () {
    return JSON.stringify(this)
  }
}

module.exports = Entity
