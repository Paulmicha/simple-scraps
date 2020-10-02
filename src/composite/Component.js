const dom = require('../utils/dom')
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
    this.indexedMultiFieldProps = {}
    // this.cid = null
  }

  getDepth () {
    return this.depth
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
   * Attaches a unique ID to be able to determine where the component belongs,
   * i.e. multi-field items or nested containers.
   *
   * @see Extractor.process()
   */
  // async setComponentID (cid) {
  //   if (cid) {
  //     this.cid = cid
  //   } else {
  //     this.extractor.markedElementsCount++
  //     this.cid = `lv${this.getDepth()}-${this.getName()}-${this.extractor.hashids.encode(this.extractor.markedElementsCount)}`
  //   }

  //   /* istanbul ignore next */
  //   await dom.evaluate(
  //     this.extractor.pageWorker.page,
  //     (selector, id) => {
  //       [...document.querySelectorAll(selector)].map((e, i) => {
  //         e.setAttribute('data-simple-scraps-cid', `${id}-delta-${i}`)

  //         // Debug.
  //         // console.log(`setComponentID() : ${id}-delta-${i}`)
  //         // console.log(`  <${e.tagName.toLowerCase()} class="${[...e.classList].join(' ')}">`)
  //       })
  //     },
  //     this.getSelector(),
  //     this.cid
  //   )
  // }

  // getComponentID () {
  //   return this.cid
  // }

  /**
   * Stores the extracted value(s) of a single "sub-field" from a multi-field
   * group.
   */
  async setMultiFieldValues (step, values, index) {
    let i = 0
    let indexes = null
    const fieldGroup = step.getMultiFieldName()
    const subField = step.getField()

    if (!step.fieldIsNestedContainer()) {
      indexes = await step.getMultiFieldPropIndexes()
    } else {
      indexes = await step.getMultiFieldNestedContainerPropIndexes()
    }

    // Debug.
    console.log(`setMultiFieldValues() : lv.${this.getDepth()} ${this.getName()}.${fieldGroup}[].${subField} (${values.length} values)`)
    console.log(`  indexes = ${indexes}`)

    if (!(fieldGroup in this.multiFieldGroups)) {
      this.multiFieldGroups[fieldGroup] = []
    }

    if (indexes) {
      for (i = 0; i < indexes.length; i++) {
        const index = indexes[i] - 1
        if (!this.multiFieldGroups[fieldGroup][index]) {
          this.multiFieldGroups[fieldGroup][index] = {}
        }
        this.multiFieldValuesSetter(step, fieldGroup, index, subField, values)
      }
    } else {
      if (Array.isArray(values)) {
        for (i = 0; i < values.length; i++) {
          if (!this.multiFieldGroups[fieldGroup][i]) {
            this.multiFieldGroups[fieldGroup][i] = {}
          }
          this.multiFieldValuesSetter(step, fieldGroup, i, subField, values[i])
        }
      } else {
        i = 0
        if (!this.multiFieldGroups[fieldGroup][i]) {
          this.multiFieldGroups[fieldGroup][i] = {}
        }
        this.multiFieldValuesSetter(step, fieldGroup, i, subField, values)
      }
    }
  }

  multiFieldValuesSetter (step, fieldGroup, i, subField, values) {
    // Debug.
    // console.log(`  multiFieldValuesSetter() : ${fieldGroup}[${i}].${subField}`)

    if (step.fieldIsNestedContainer()) {
      if (!(subField in this.multiFieldGroups[fieldGroup][i])) {
        this.multiFieldGroups[fieldGroup][i][subField] = []
      }
      this.multiFieldGroups[fieldGroup][i][subField].push(values)

      // Debug.
      // console.log(`    PUSH ${JSON.stringify(values)}`)
      // console.log(`    PUSH ${values}`)
    } else {
      this.multiFieldGroups[fieldGroup][i][subField] = values[i]

      // Debug.
      // console.log(`    SET ${values[i]}`)
    }
  }

  getMultiFieldItems (step) {
    return this.multiFieldGroups[step.getMultiFieldName()]
  }
}

module.exports = Component
