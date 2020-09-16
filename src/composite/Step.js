const Iterable = require('./Iterable')

/**
 * Composite collection item wrapping extraction configs and components.
 *
 * This is necessary because multiple extraction steps may run for extracting
 * a single component (which can have multiple fields - each requiring a
 * distinct selector, thus a distinct extraction step).
 *
 * Each instance of this class represents a single extraction step which will
 * be exectued in Extractor.process() method.
 */
class Step extends Iterable {
  constructor (extractor, config) {
    super(extractor, config)
    this.component = config.component
    this.emit = config.emit
  }

  getField () {
    const destination = this.as.split('.')
    if (destination.length > 2) {
      return destination[2]
    }
    return destination[1]
  }

  getComponent () {
    return this.component
  }
}

module.exports = Step
