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
    this.emit = config.emit
  }

  getDestination () {
    return this.as.split('.')
  }

  getField () {
    let field = ''
    const destination = this.getDestination()

    if (destination.length > 2) {
      field = destination[destination.length - 1]
    } else {
      field = destination[1]
    }

    if (field.includes('[]')) {
      field = field.replace('[]', '')
    }

    return field
  }

  getComponent () {
    return this.getParentComponent()
  }

  fieldIsNestedContainer () {
    return this.extractor.main.getSetting('extractionContainerTypes').includes(this.extract)
  }

  isMultiField () {
    const destination = this.getDestination()
    return destination.length > 1 &&
      destination[destination.length - 2].includes('[]')
  }

  /**
   * Gets the field name for the group that will store the extracted value(s) of
   * a single "sub-field".
   *
   * This field will be the same for multiple destinations like :
   * - component.MediaGrid.items[].image
   * - component.MediaGrid.items[].title
   * - component.MediaGrid.items[].text
   *
   * But not :
   * - component.MediaGrid.title
   * - component.MediaGrid.otherGroup[].title
   *
   * -> The same field (i.e. in the example above : 'title') may have to be
   * assigned to different destinations in the same component.
   */
  getMultiFieldName () {
    const destination = this.getDestination()

    if (destination[0] === 'component') {
      destination.shift()
    }
    if (destination[0] === this.getComponent().getName()) {
      destination.shift()
    }

    let name = destination.shift()

    if (name.includes('[]')) {
      name = name.replace('[]', '')
    }

    return name
  }
}

module.exports = Step
