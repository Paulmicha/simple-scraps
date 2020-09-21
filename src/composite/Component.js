const Iterable = require('./Iterable')

/**
 * Composite element representing a piece of the extraction result.
 *
 * @see src/composite/Container.js
 * @see src/composite/Leaf.js
 */
class Component extends Iterable {
  constructor (extractor, config) {
    super(extractor, config)
    this.container = config ? config.component : null
    this.extracted = {}
    this.multiFieldGroups = {}
  }

  getName () {
    const destination = this.as.split('.')
    return destination[1] || this.as
  }

  setField (prop, value) {
    this.extracted[prop] = value
  }

  getExtractionResult () {
    return this.extracted
  }

  /**
   * Stores the extracted value(s) of a single "sub-field" from a multi-field
   * group.
   */
  setMultiFieldValues (step, values, index) {
    let i = 0
    const fieldGroup = step.getMultiFieldName()
    const subField = step.getField()

    // Debug.
    console.log(`setMultiFieldValues() : ${fieldGroup}[].${subField} (${values.length} values)`)

    if (!(fieldGroup in this.multiFieldGroups)) {
      this.multiFieldGroups[fieldGroup] = []
    }

    if (typeof index !== 'undefined') {
      if (!this.multiFieldGroups[fieldGroup][index]) {
        this.multiFieldGroups[fieldGroup][index] = {}
      }
      this.multiFieldGroups[fieldGroup][index][subField] = values
      return
    }

    if (Array.isArray(values)) {
      for (i = 0; i < values.length; i++) {
        if (!this.multiFieldGroups[fieldGroup][i]) {
          this.multiFieldGroups[fieldGroup][i] = {}
        }
        this.multiFieldGroups[fieldGroup][i][subField] = values[i]
      }
    } else {
      i = 0
      if (!this.multiFieldGroups[fieldGroup][i]) {
        this.multiFieldGroups[fieldGroup][i] = {}
      }
      this.multiFieldGroups[fieldGroup][i][subField] = values
    }

    // Debug.
    // console.log(`  -> multiFieldGroups : ${JSON.stringify(this.multiFieldGroups, null, 2)}`)
  }

  getMultiFieldItems (step) {
    return this.multiFieldGroups[step.getMultiFieldName()]
  }
}

module.exports = Component
