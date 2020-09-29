const dom = require('../utils/dom')
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
    this.processed = false
    this.component = config.component
    this.multiFieldScopeDelimiter = ''
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
    return this.component
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
   * all "sub-fields".
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
   *
   * @example
   *   this.as = 'component.MediaGrid.items[].image'
   *   const group = this.getMultiFieldName()
   *   // group = 'items'
   *   const index = this.getMultiFieldIndex()
   *   // index = 1
   *   const subField = this.getField()
   *   // subField = 'image'
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

  scopeMultiFieldSelector () {
    if (!this.isMultiField()) {
      return
    }

    const component = this.getComponent()

    if (!component.getConf('multiFieldScopes')) {
      return
    }

    const multiFieldName = this.getMultiFieldName()
    const multiFieldScopes = component.getConf('multiFieldScopes')

    if (!(multiFieldName in multiFieldScopes)) {
      return
    }

    this.multiFieldScopeDelimiter = multiFieldScopes[multiFieldName]

    // Debug.
    // console.log(`scopeMultiFieldSelector() - delimiter = ${this.multiFieldScopeDelimiter}`)

    this.setSelector(`${this.multiFieldScopeDelimiter} ${this.getSelector()}`)
  }

  /**
   * Attaches a data-attribute to elements corresponding to multi-field items'
   * props to determine which item of the group they belong to.
   *
   * Must run AFTER Iterable.scopeSelector() due to "select" keys handling.
   */
  async setMultiFieldIndexes () {
    const component = this.getComponent()
    const multiFieldProp = `${this.getMultiFieldName()}.${this.getField()}`

    if (multiFieldProp in component.indexedMultiFieldProps ||
      !this.multiFieldScopeDelimiter.length) {
      return
    }

    // Debug.
    console.log(`setMultiFieldIndexes() for prop : ${multiFieldProp}`)
    // this.locate('  for : ')

    // The elements that delimit our multi-field items start at the component
    // scope.
    const delimitersSelector = `${component.getSelector()} ${this.multiFieldScopeDelimiter}`
    // const scopeSelectorRegexSafe = delimitersSelector.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')
    // const currentPropSelector = this.getSelector().replace(new RegExp(`^${scopeSelectorRegexSafe}`), '')

    // Debug.
    // console.log(`  delimitersSelector = ${delimitersSelector}`)
    // console.log(`  currentPropSelector = ${currentPropSelector}`)

    /* istanbul ignore next */
    await dom.evaluate(
      this.extractor.pageWorker.page,
      (multiFieldScopeDelimiter, delimitersSelector, currentPropSelector) => {
        const itemsWrappers = [...document.querySelectorAll(delimitersSelector)]
        itemsWrappers.map((e, i) => {
          e.setAttribute('data-simple-scraps-multi-field-i', i)
        })

        const currentPropElements = [...document.querySelectorAll(currentPropSelector)]
        currentPropElements.map((e) => {
          const index = e.closest(multiFieldScopeDelimiter).getAttribute('data-simple-scraps-multi-field-i')
          e.setAttribute('data-simple-scraps-multi-field-i', index)
        })
      },
      this.multiFieldScopeDelimiter,
      delimitersSelector,
      this.getSetting()
    )

    component.indexedMultiFieldProps[multiFieldProp] = true
  }

  getMultiFieldIndex () {
    // TODO (wip)
  }

  isProcessed () {
    return this.processed
  }
}

module.exports = Step
