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
  const url = pageWorker.page.url()
  let content = await pageWorker.getContent()

  if (main.getSetting('beautifyHtml')) {
    content = beautifyHtml(content, {
      indent_size: 2,
      max_preserve_newlines: 1
    })
  }

  // Make storage pluggable.
  const hadListeners = main.emit('store.page.markup', content, url, pageWorker)
  if (hadListeners) {
    return
  }

  // Fallback to default storage if no provider was found.
  const filePath = urlToFilePath('data/cache', url, '.html')
  if (main.getSetting('cacheSkipExisiting') && fs.existsSync(filePath)) {
    return
  }

  await writeFile(filePath, content)
}

/**
 * Saves page screenshot.
 *
 * @emits store.page.screenshot
 */
const screenshot = async (pageWorker, main) => {
  const url = pageWorker.page.url()

  // Make storage pluggable.
  const hadListeners = main.emit('store.page.screenshot', url, pageWorker)
  if (hadListeners) {
    return
  }

  // Fallback to default storage if no provider was found.
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
}

module.exports = {
  savePageMarkup,
  screenshot
}
