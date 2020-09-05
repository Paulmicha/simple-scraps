const test = require('ava')
const puppeteer = require('puppeteer')
const path = require('path')
const Page = require('../src/Page')
const defaultConfig = require('../src/utils/default_config.js')

// We use a custom object to mock '../src/Main' class, which is not the one
// being tested here.
const ScraperMock = {}
ScraperMock.getSetting = (setting) => defaultConfig.setting(setting)

// Local static pages URLs.
const urls = {
  blog: 'file://' + path.resolve(__dirname, 'static', 'Blog.html')
}

// This runs before all tests.
test.before(async t => {
  ScraperMock.browser = await puppeteer.launch()
})

test('1. Opening a URL', async t => {
  const pageWorker = new Page(ScraperMock)
  await pageWorker.init()
  // await pageWorker.page.goto(`file:${urls.blog}`)
  // t.is(`file://${urls.blog}`, pageWorker.page.url())
  await pageWorker.page.goto(urls.blog)
  t.is(urls.blog, pageWorker.page.url())
})

// TODO test common crawling issues :
//  - Position:fixed (test if this does not make screenshots partially
//    unreadable, and if so, convert to absolute positions ?)
//  - Timeouts (+ closing modals, popups) :
//    cf. https://stackoverflow.com/a/48865555/2592338
//    cf. https://github.com/bargoldi/time-events-manager
//  - Infinite scroll :
//    cf. https://intoli.com/blog/scrape-infinite-scroll/
//    example :
//      let items = [];
//      try {
//        let previousHeight;
//        while (items.length < itemTargetCount) {
//          items = await page.evaluate(extractItems);
//          previousHeight = await page.evaluate('document.body.scrollHeight');
//          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
//          await page.waitForFunction(`document.body.scrollHeight > ${previousHeight}`);
//          await page.waitFor(scrollDelay);
//        }
//      } catch(e) {}
