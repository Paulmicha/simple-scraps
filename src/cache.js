/**
 * @file
 * Local file-based cache.
 */

const urlParse = require('url-parse')
const slugify = require('@sindresorhus/slugify')
const { writeFile } = require('./utils/fs')

/**
 * Converts an URL to a cache file path.
 */
const cacheGetFilePath = (url) => {
  const parsedUrl = urlParse(url)
  if (parsedUrl.pathname.length === 0 || parsedUrl.pathname === '/') {
    parsedUrl.pathname = '/index'
  }
  const pathParts = parsedUrl.pathname.split('/')
  const filePath = pathParts.map(part => slugify(part)).join('/')
  return `cache/${parsedUrl.hostname + filePath}.html`
}

/**
 * Saves page HTML into local cache file.
 */
const cachePage = (url, content) => {
  writeFile(cacheGetFilePath(url), content)
}

module.exports = {
  cachePage: cachePage
}
