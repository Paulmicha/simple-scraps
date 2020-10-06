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

  getDepth () {
    const component = this.getComponent()
    if (component) {
      return component.getDepth()
    }
    return this.depth
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

  /**
   * Prepends multi-field items props selectors for items delimited via
   * component.getConf('multiFieldScopes') - object keyed by multi-field group
   * names which returns an unscoped CSS selector pointing at the "wrapper"
   * elements (containing all props to extract for each item).
   */
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
   * There are 3 possibilities to determine what delimits items :
   * 1. Via component.getConf('multiFieldScopes') - object keyed by multi-field
   *   group names which returns an unscoped CSS selector pointing at the
   *   "wrapper" elements (containing all props to extract for each item)
   * 2. Via this.getConf('multiFieldScope') - allows to specifiy this selector
   *   on a per-prop basis.
   * 3. Fallback to this.getSelector() if nothing else was found.
   *
   * Must run AFTER Iterable.scopeSelector() due to "select" keys handling.
   */
  async setMultiFieldIndexes () {
    const component = this.getComponent()
    const multiFieldProp = `${this.getMultiFieldName()}.${this.getField()}`

    // Memoization (minor optimization).
    if (multiFieldProp in component.indexedMultiFieldProps) {
      return
    }

    // Items delimitor may have been set during this.scopeMultiFieldSelector().
    if (!this.multiFieldScopeDelimiter.length && this.getConf('multiFieldScope')) {
      // Otherwise, look for the "multiFieldScope" in this Step's config.
      this.multiFieldScopeDelimiter = this.getConf('multiFieldScope')
    }

    // Debug.
    // console.log(`setMultiFieldIndexes() for lv.${component.getDepth()} ${component.getName()}.${multiFieldProp}`)
    // this.locate('  for : ')

    // The elements that delimit our multi-field items start at the component
    // scope.
    const delimitersSelector = this.multiFieldScopeDelimiter.length
      ? `${component.getSelector()} ${this.multiFieldScopeDelimiter}`
      : this.getSelector()
    // const scopeSelectorRegexSafe = delimitersSelector.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&')
    // const currentPropSelector = this.getSelector().replace(new RegExp(`^${scopeSelectorRegexSafe}`), '')

    // Debug.
    // console.log(`  delimitersSelector = ${delimitersSelector}`)
    // console.log(`  currentPropSelector = ${currentPropSelector}`)

    /* istanbul ignore next */
    await dom.evaluate(
      this.extractor.pageWorker.page,
      (delimitersSelector, currentPropSelector) => {
        // 1. Set index on wrapper elements (containing the props of a single
        // item).
        const itemsWrappers = [...document.querySelectorAll(delimitersSelector)]
        itemsWrappers.map((e, i) => {
          e.setAttribute('data-simple-scraps-multi-field-i', i)

          // Debug.
          // console.log(`  i=${e.getAttribute('data-simple-scraps-multi-field-i')} <${e.tagName.toLowerCase()} class="${[...e.classList].join(' ')}">`)
        })
        // 2. Apply that index on the element(s) from which the current prop
        // value(s) will be extracted.
        if (currentPropSelector !== delimitersSelector) {
          const currentPropElements = [...document.querySelectorAll(currentPropSelector)]
          currentPropElements.map(e => {
            const index = e.closest('[data-simple-scraps-multi-field-i]')
              .getAttribute('data-simple-scraps-multi-field-i')
            if (index) {
              e.setAttribute('data-simple-scraps-multi-field-i', index)

              // Debug.
              // console.log(`  index=${index} <${e.tagName.toLowerCase()} class="${[...e.classList].join(' ')}">`)
            }
          })
        }
      },
      delimitersSelector,
      this.getSelector()
    )

    component.indexedMultiFieldProps[multiFieldProp] = true

    // Debug.
    // const indexes = await this.getMultiFieldPropIndexes()
    // console.log(`  indexes = '${indexes}'`)
  }

  /**
   * Returns an array of numerical indexes corresponding to the wrapper
   * element(s) of the items of the multi-field group the current prop value(s)
   * will be part of.
   *
   * TODO (wip) some extractions configs must support multi-field items that
   * do not share a common wrapper element we could use to regroup and
   * assign the values to the "correct" item.
   */
  async getMultiFieldPropIndexes () {
    const indexes = await dom.attribute(
      this.extractor.pageWorker.page,
      this.getSelector(),
      'data-simple-scraps-multi-field-i'
    )
    if (indexes) {
      // return indexes.filter(i => i)
      return indexes
    }
  }

  /**
   * Returns an array of numerical indexes corresponding to the wrapper
   * element(s) of matched component(s) in current multi-field prop, when it is
   * a "container" field type (i.e. contains components).
   *
   * @example
   *  // For this extraction config :
   *  {
   *    "selector": "> .tab-content > .tab-pane",
   *    "extract": "components",
   *    "as": "component.NavTabs.items[].content"
   *  }
   *  // When lower levels return e.g. 3 components, calling this :
   *  const indexes = step.getMultiFieldNestedContainerPropIndexes()
   *  // Would give e.g. :
   *  // [2, 1, 1]
   *  // -> Meaning : 1st component belongs to multi-field item 2, and the 2nd
   *  // and 3rd components to item 1.
   */
  async getMultiFieldNestedContainerPropIndexes () {
    const component = this.getComponent()
    if (component.constructor.name !== 'Container') {
      return
    }
    const children = component.getChildren()
      .filter(child => JSON.stringify(child.getExtractionResult()) !== '{}')

    // Debug.
    // const fieldGroup = this.getMultiFieldName()
    // const subField = this.getField()
    // console.log(`getMultiFieldNestedContainerPropIndexes() : lv.${component.getDepth()} ${component.getName()}.${fieldGroup}[].${subField} (${children.length} children)`)

    if (!children.length) {
      return
    }

    const childrenSelectors = []
    let childrenDepth = 0

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      childrenDepth = child.getDepth()
      childrenSelectors.push(child.getSelector())
    }

    /* istanbul ignore next */
    const childrenIndexes = await dom.evaluate(
      this.extractor.pageWorker.page,
      (childrenSelectors, childrenDepth) => {
        const childrenIndexes = []
        const children = [...document.querySelectorAll(childrenSelectors)]

        children.map(e => {
          const elDepth = e.getAttribute('data-simple-scraps-depth')

          if (parseInt(elDepth) !== parseInt(childrenDepth)) {
            return
          }

          if (e.hasAttribute('data-simple-scraps-multi-field-i')) {
            const index = e.getAttribute('data-simple-scraps-multi-field-i')
            if (index) {
              childrenIndexes.push(index)

              // Debug.
              // console.log(`  index = ${index} for <${e.tagName.toLowerCase()} class="${[...e.classList].join(' ')}">`)
            }
          } else {
            const index = e.closest('[data-simple-scraps-multi-field-i]')
              .getAttribute('data-simple-scraps-multi-field-i')
            if (index) {
              childrenIndexes.push(index)

              // Debug.
              // console.log(`  index = ${index} for <${e.tagName.toLowerCase()} class="${[...e.classList].join(' ')}">`)
            }
          }
        })

        return childrenIndexes
      },
      childrenSelectors,
      childrenDepth
    )

    return childrenIndexes
  }

  isProcessed () {
    return this.processed
  }
}

module.exports = Step
