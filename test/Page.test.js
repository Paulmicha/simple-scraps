const test = require('ava')
const puppeteer = require('puppeteer')
const path = require('path')
const Page = require('../src/Page')
const defaultConfig = require('../src/utils/default_config.js')

// We use a custom object to mock '../src/Main' class.
const ScraperMock = {}
ScraperMock.getSetting = (setting) => defaultConfig.setting(setting)

// Local static pages URLs (file:///).
const urls = {
  blog: path.resolve(__dirname, 'static', 'Blog.html')
}

// This runs before all tests.
test.before(async t => {
  ScraperMock.browser = await puppeteer.launch()
})

test('1. Opening a URL', async t => {
  const pageWorker = new Page(ScraperMock)
  await pageWorker.init()
  await pageWorker.page.goto(`file:${urls.blog}`)
  t.is(`file://${urls.blog}`, pageWorker.page.url())
})
