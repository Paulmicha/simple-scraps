/**
 * Defines a common base for sortable Collection items (via Iterator).
 *
 * @see src/composite/Step.js
 * @see src/composite/Component.js (-> Container, Leaf)
 */
class Iterable {
  constructor (extractor, config) {
    this.extractor = extractor

    this.depth = 0
    this.scope = ''
    this.ancestors = []
    this.ancestorsChain = ''

    if (!config) {
      config = this.extractor.rootExtractionConfig
    }

    this.selector = config.selector
    this.extract = config.extract
    this.as = config.as
  }

  /**
   * Separates parent extraction config object reference from parent Iterable
   * instance.
   *
   * This avoids infinite recursion when looking for instances of a component
   * inside itself or one of its descendants.
   * @see Extractor.getAncestors()
   *
   * @param {Object} parentConfig (optional) the extraction config the current
   *   step is part of. Defaults to the page document root extraction config.
   */
  setParentConfig (parentConfig) {
    if (parentConfig) {
      this.parentConfig = parentConfig
    } else {
      this.parentConfig = this.extractor.rootExtractionConfig
    }
  }

  getParentConfig () {
    return this.parentConfig
  }

  /**
   * Separates parent extraction config object reference from parent Iterable
   * instance.
   *
   * This avoids infinite recursion when looking for instances of a component
   * inside itself or one of its descendants.
   * @see Extractor.getAncestors()
   *
   * @param {Iterable} parentInstance the parent Iterable instance.
   */
  setParentInstance (parentInstance) {
    this.parentInstance = parentInstance
  }

  getParentInstance () {
    return this.parentInstance
  }

  /**
   * Base ancestors + ancestorsChain props setter.
   *
   * @param {array} ancestors result of Extractor.getAncestors().
   */
  setAncestors (ancestors) {
    this.ancestors = ancestors

    if (this.ancestors && this.ancestors.length) {
      this.ancestorsChain += this.ancestors
        .map(e => e.as)
        .filter(e => e && e.length)
        .join(' <- ')
      if (this.ancestorsChain.length) {
        this.ancestorsChain += ' <- '
      }
    }
    this.ancestorsChain += this.as

    this.setDepth()

    // Debug.
    // console.log(`  result : ${this.getDepth()}`)
  }

  /**
   * Returns an array of objects that represents a "nesting chain" from current
   * depth level to the root (depth 0).
   */
  getAncestors (type) {
    const ancestors = []
    let loopObject = this.getAncestor(type, this)

    if (!loopObject) {
      return ancestors
    }

    loopObject = { ...loopObject }
    let i = this.extractor.main.getSetting('maxExtractionNestingDepth')

    while (i > 0 && loopObject) {
      ancestors.push(loopObject)
      loopObject = this.getAncestor(type, loopObject)
      if (!loopObject) {
        break
      }
      loopObject = { ...loopObject }
      i--
    }

    return ancestors.reverse()
  }

  getAncestor (type, instance) {
    switch (type) {
      case 'config':
        return instance.getParentConfig()
      case 'instance':
        return instance.getParentInstance()
    }
  }

  getAncestorsChain () {
    return this.ancestorsChain
  }

  /**
   * Always set depth level to 0 if instance has a single ancestor (the page
   * document root).
   *
   * @param {Number} depth (optional) Allows overriding this method's result.
   */
  setDepth (depth) {
    // Debug.
    // console.log(`setDepth(${depth || ''}) : '${this.ancestorsChain}'`)

    if (depth) {
      this.depth = depth
      return
    }
    if (this.ancestors.length && this.ancestors.length > 2) {
      this.depth = this.ancestors.length - 2
      return
    }
    this.depth = 0
  }

  getDepth () {
    return this.depth
  }

  setScope (scope) {
    this.scope = scope
  }

  getScope () {
    return this.scope
  }

  /**
   * Debug utility.
   */
  locate (prefix) {
    if (!prefix) {
      prefix = ''
    }

    const depth = this.getDepth()
    const debugIndent = prefix + '  '.repeat(depth)

    console.log(`${debugIndent}lv.${depth} ${this.constructor.name}: ${this.ancestorsChain}`)

    if (this.selector) {
      console.log(`${debugIndent}  ( ${this.selector} )`)
    }
  }
}

module.exports = Iterable
