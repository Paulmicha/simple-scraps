
/**
 * Exports the composite tree to the structured extraction result object.
 */
class ExportVisitor {
  constructor (iterator) {
    this.iterator = iterator
  }

  visitLeaf (leaf) {
    return leaf.getExtractionResult()
  }

  visitContainer (container) {
    // TODO (wip)
    // console.log(`TODO (wip) export ${container}`)
    return container.getExtractionResult()
  }
}

module.exports = ExportVisitor
