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
 * @param {Page} pageWorker instance.
 * @param {Main} main scraper instance to emit events in order to support
 *  pluggable storage process.
 * @return {boolean} Success flag.
 */
const saveExtractionResult = async (entity, entityType, bundle, pageWorker, main) => {
  const url = pageWorker.page.url()

  // Make storage pluggable.
  const hadListeners = main.emit('store.extraction.result', entity, entityType, bundle, url, pageWorker)
  if (hadListeners) {
    return
  }

  // Fallback to default storage if no provider was found.
  const filePath = entityToFilePath('data/output', null, url, entityType, bundle)
  if (main.getSetting('outputSkipExisiting') && fs.existsSync(filePath)) {
    return
  }

  await writeFile(filePath, JSON.stringify(entity, null, 2))
}

module.exports = {
  saveExtractionResult
}
