/**
 * Defines a common base for sortable Collection items (via Iterator).
 *
 * @see src/composite/Step.js
 * @see src/composite/Component.js (-> Container, Leaf)
 */
class Iterable {
  constructor (config) {
    this.depth = 0
    this.scope = ''
    this.ancestors = []
    this.ancestorsChain = ''

    this.selector = config ? config.selector : ''
    this.extract = config ? config.extract : '*'
    this.as = config ? config.as : 'root'
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
   * Always set depth level to 0 if instance has a single ancestor (the page
   * document root).
   *
   * @param {Number} depth (optional) Allows overriding this method's result.
   */
  setDepth (depth) {
    // Debug.
    // console.log(`setDepth(${depth}) / this.ancestorsChain = '${this.ancestorsChain}'`)

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
  locate () {
    const depth = this.getDepth()
    const debugIndent = '  '.repeat(depth)

    console.log(`${debugIndent}lv.${depth} ${this.constructor.name}: ${this.ancestorsChain}`)
    console.log(`${debugIndent}  ( ${this.selector} )`)
  }
}

module.exports = Iterable
