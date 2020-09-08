/**
 * @file
 * Provides default configuration values for all scraper settings.
 */

/**
 * Returns fallback values by setting.
 */
const setting = (key) => {
  switch (key) {
    // TODO device emulation (i.e. mobile) ?
    case 'pageW':
      return 1280
    case 'pageH':
      return 800
    case 'addDomQueryHelper':
      return true
    case 'maxParallelPages':
      return 4
    case 'crawlDelay':
      return [500, 2500]
    // TODO instead, leave more options inside each "follow" config. E.g.
    // screenshot format, quality, device emulation / resolution, etc.
    // -> Deprecated.
    case 'cacheWithScreenshot':
      return true
    case 'cacheSkipExisiting':
      return true
    case 'beautifyHtml':
      return true
    // TODO instead of boolean setting, use enum or something pluggable to
    // support different strategies to deal with previously extracted
    // objects (during reruns).
    case 'outputSkipExisiting':
      return true
    case 'plainTextRemoveBreaks':
      return true
    case 'plainTextSeparator':
      return ' '
    case 'minifyExtractedHtml':
      return true
    case 'maxExtractionNestingDepth':
      return 9
  }
}

module.exports = {
  setting
}
