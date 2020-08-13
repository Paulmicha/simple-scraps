const puppeteer = require('puppeteer');

(async () => {

  const url = "https://www.chouette.net.br/blog";

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);


  const html = await page.content();
  console.log(html);


  /*

  // await page.screenshot({path: 'example.png'});

  const items_selector = '.view-chouette-articles article h2 > a';
  await page.waitForSelector(items_selector);

  // const pager_selector = '.view-chouette-articles .c-pagination a';

  const links = await page.evaluate((q) => {
    const anchors = Array.from(document.querySelectorAll(q));
    return anchors.map((anchor) => {
      const title = anchor.textContent.trim();
      return `${title} - ${anchor.href}`;
    });
  }, items_selector);

  console.log(links.join('\n'));

  */

  await browser.close();
})();
