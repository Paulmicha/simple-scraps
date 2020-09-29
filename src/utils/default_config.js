/**
 * @file
 * Provides default configuration values for all scraper settings.
 */

/**
 * Returns fallback values by setting.
 */
const setting = (key) => {
  const defaults = {}

  // TODO device emulation (i.e. mobile) ?
  defaults.pageW = 1280
  defaults.pageH = 800
  defaults.addDomQueryHelper = false
  defaults.maxParallelPages = 4
  defaults.crawlDelay = [500, 2500]

  // TODO instead, leave more options inside each "follow" config. E.g.
  // screenshot format, quality, device emulation / resolution, etc.
  // -> Deprecated.
  defaults.cacheWithScreenshot = true
  defaults.cacheSkipExisiting = true
  defaults.beautifyHtml = true

  // TODO instead of boolean setting, use enum or something pluggable to
  // support different strategies to deal with previously extracted
  // objects (during reruns).
  defaults.outputSkipExisiting = true
  defaults.plainTextRemoveBreaks = true
  defaults.plainTextSeparator = ' '
  defaults.minifyExtractedHtml = true
  defaults.extractionContainerTypes = ['components']
  defaults.maxExtractionNestingDepth = 9
  defaults.selectorExistsTimeout = 150
  defaults.selectorExistsRetries = 2
  defaults.selectorExistsRetriesMul = 1.75

  if (key in defaults) {
    return defaults[key]
  }
}

module.exports = {
  setting
}
