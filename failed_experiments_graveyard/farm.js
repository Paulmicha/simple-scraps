const puppeteer = require('puppeteer');
const workerFarm = require('worker-farm');
const workers = workerFarm(require.resolve('./operations'), ['find_links']);

/**
 * Main process.
 */
(async () => {
  const options = {};

  options.browser = await puppeteer.launch();
  options.page = await options.browser.newPage();
  options.url = "https://www.chouette.net.br/blog";

  workers.find_links(options, (err, op) => {
    console.log(err);
    console.log(op);
  });

  await options.browser.close();
})();
