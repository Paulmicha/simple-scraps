/**
 * @file
 * Contains local file-based cache implementations.
 */

const fs = require('fs')
const beautifyHtml = require('js-beautify').html
const { writeFile } = require('./utils/fs')
const { urlToFilePath } = require('./utils/default_storage')

/**
 * Saves page HTML into local cache file.
 *
 * @emits store.page.markup
 */
const savePageMarkup = async (pageWorker, main) => {
  const storage = {}
  const url = pageWorker.page.url()
  let content = await pageWorker.getContent()

  if (main.getSetting('beautifyHtml')) {
    content = beautifyHtml(content, {
      indent_size: 2,
      max_preserve_newlines: 1
    })
  }

  // Make storage pluggable.
  main.emit('store.page.markup', storage)

  // Fallback to default storage if no provider was found.
  if (!('store' in storage)) {
    const filePath = urlToFilePath('data/cache', url, '.html')

    if (main.getSetting('cacheSkipExisiting') && fs.existsSync(filePath)) {
      return
    }

    await writeFile(filePath, content)
    return
  }

  // Otherwise, call the provider implementation.
  storage.store({ url, content, pageWorker, main })
}

/**
 * Saves page screenshot.
 *
 * @emits store.page.screenshot
 */
const screenshot = async (pageWorker, main) => {
  const storage = {}
  const url = pageWorker.page.url()

  // Make storage pluggable.
  main.emit('store.page.screenshot', storage)

  // Fallback to default storage if no provider was found.
  if (!('store' in storage)) {
    let suffix = '.screenshot-'
    suffix += main.getSetting('pageW') + 'x' + main.getSetting('pageH')
    suffix += '.png'

    const filePath = urlToFilePath('data/cache', url, suffix)

    if (main.getSetting('cacheSkipExisiting') && fs.existsSync(filePath)) {
      return
    }

    await pageWorker.page.screenshot({
      path: filePath,
      fullPage: true
    })
    return
  }

  // Otherwise, call the provider implementation.
  storage.store({ url, pageWorker, main })
}

module.exports = {
  savePageMarkup,
  screenshot
}
