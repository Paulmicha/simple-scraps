/**
 * @file
 * Contains scraping results storage implementations.
 */

const fs = require('fs')
const { writeFile } = require('./utils/fs')
const { entityToFilePath } = require('./utils/default_storage')

/**
 * Saves extraction result (entity) object.
 *
 * @emits store.extraction.result
 *
 * @param {object} entity object to store.
 * @param {Extractor} extractor instance.
 * @return {boolean} Success flag.
 */
const saveExtractionResult = async (entity, extractor) => {
  const url = extractor.pageWorker.page.url()

  // Make storage pluggable.
  const hadListeners = extractor.main.emit('store.extraction.result', entity, extractor.entityType, extractor.bundle, url, extractor.pageWorker)
  if (hadListeners) {
    return
  }

  // Fallback to default storage if no provider was found.
  const filePath = entityToFilePath('data/output', null, url, extractor.entityType, extractor.bundle)
  if (extractor.main.getSetting('outputSkipExisiting') && fs.existsSync(filePath)) {
    return
  }

  await writeFile(filePath, JSON.stringify(entity, null, 2))
}

module.exports = {
  saveExtractionResult
}
