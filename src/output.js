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
const saveExtractionResult = async (entity, pageWorker, main) => {
  const storage = {}
  const url = pageWorker.page.url()

  // Make storage pluggable.
  main.emit('store.extraction.result', storage)

  // Fallback to default storage if no provider was found.
  if (!('store' in storage)) {
    const filePath = entityToFilePath('data/output', url)

    if (main.getSetting('outputSkipExisiting') && fs.existsSync(filePath)) {
      return
    }

    await writeFile(filePath, JSON.stringify(entity, null, 2))
    return
  }

  // Otherwise, call the provider implementation.
  storage.store({ url, entity, pageWorker, main })
}

module.exports = {
  saveExtractionResult
}
