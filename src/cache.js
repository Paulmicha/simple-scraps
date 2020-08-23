/**
 * @file
 * Contains local file-based cache implementations.
 */

const fs = require('fs')
const urlParse = require('url-parse')
const slugify = require('@sindresorhus/slugify')
const beautifyHtml = require('js-beautify').html
const { writeFile } = require('./utils/fs')

/**
 * Converts an URL to a cache file path.
 */
const getFilePath = (url, suffix) => {
  if (!suffix) {
    suffix = '.html'
  }
  const parsedUrl = urlParse(url)
  if (parsedUrl.pathname.length === 0 || parsedUrl.pathname === '/') {
    parsedUrl.pathname = '/index'
  }
  const pathParts = parsedUrl.pathname.split('/')
  const filePath = pathParts.map(part => slugify(part)).join('/')

  // For query args and anchors, convert to a file name safe string.
  let extras = ''
  if (parsedUrl.query) {
    // extras += parsedUrl.query.replace(/\?|=|&/g, '.')
    extras += '.' + slugify(parsedUrl.query)
  }
  if (parsedUrl.hash) {
    extras += parsedUrl.hash.replace('#', '.')
  }

  const fileName = parsedUrl.hostname + filePath + extras
  return `data/cache/${fileName}${suffix}`
}

/**
 * Saves page HTML into local cache file.
 */
const writePageMarkup = (url, content, skipExisting) => {
  const filePath = getFilePath(url)
  if (skipExisting && fs.existsSync(filePath)) {
    return
  }
  writeFile(filePath, beautifyHtml(content, {
    indent_size: 2,
    max_preserve_newlines: 1
  }))
}

module.exports = {
  getFilePath: getFilePath,
  writePageMarkup: writePageMarkup
}
