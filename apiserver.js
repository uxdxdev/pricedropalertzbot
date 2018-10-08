'use latest';
import bodyParser from 'body-parser';
import express from 'express';
import Webtask from 'webtask-tools';
import cheerio from 'cheerio';
import convert from 'xml-js';
import requestModule from 'request';
import Promise from 'promise';
import 'babel-polyfill';

const request = requestModule.defaults({
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:62.0) Gecko/20100101 Firefox/62.0'
  }
});

const server = express();
server.use(bodyParser.json());

const AMAZON_UK_URL = 'https://www.amazon.co.uk/gp/product/';
const productTitleId = 'span#productTitle';

const headerPriceValueId = 'span.header-price';
const ourPriceValueId = 'span#priceblock_ourprice';
const offerPriceValueId = 'span.offer-price';
const salePriceValueId = 'span#priceblock_saleprice';
const aColorPriceValueId = 'span.a-color-price';

const isbn10Id = 'li:contains(ISBN-10:)';
const isbn13Id = 'li:contains(ISBN-13:)';

const CURRENTLY_READING = 'currently-reading';
const TO_READ = 'to-read';

const getAmazonProductInfo = asin => {
  if (asin === '' || asin === null || asin === undefined) return null;
  console.debug('⚡️ Analysing product information', asin);
  return new Promise((resolve, reject) => {
    request(AMAZON_UK_URL + asin, (error, response, body) => {
      if (error) {
        console.debug('SERVER error requesting information from amazon');
        return reject();
      }
      if (response.statusCode === 200) {
        const $ = cheerio.load(body);

        const title = $(productTitleId)
          .text()
          .trim();

        // price location varies so we need to check for multiple selectors
        const priceArray = [];
        const headerPrice = $(headerPriceValueId)
          .text()
          .trim();
        const ourPrice = $(ourPriceValueId)
          .text()
          .trim();
        const salePrice = $(salePriceValueId)
          .text()
          .trim();
        const offerPrice = $(offerPriceValueId)
          .first()
          .text()
          .trim();
        const aColorPrice = $(aColorPriceValueId)
          .first()
          .text()
          .trim();

        priceArray.push(headerPrice);
        priceArray.push(ourPrice);
        priceArray.push(offerPrice);
        priceArray.push(salePrice);
        priceArray.push(aColorPrice);

        const rawPrice = handlePriceProcessing(priceArray);

        const isbn10 = $(isbn10Id)
          .text()
          .replace('ISBN-10: ', '');
        const isbn13 = $(isbn13Id)
          .text()
          .replace('ISBN-13: ', '');
        if (rawPrice) {
          // remove the currency marker, remove new line characters, and only
          // use the first 8 characters in the string. Fixes the issue with
          // extra characters in string from cheerio
          const price = rawPrice
            .replace('£', '')
            .replace('\n', '')
            .substring(0, 6);
          const pageInformation = {
            title,
            price,
            asin,
            isbn10,
            isbn13
          };
          console.debug(
            'SERVER successfully parsed amazon page for item',
            asin
          );
          return resolve(pageInformation);
        }
        console.debug('SERVER error no raw price');
        return reject();
      }
      console.debug('SERVER error status code', response.statusCode);
      return reject();
    });
  });
};

/**
 * Iterate over the price array and return the first price encountered.
 * The price array contains prices parsed from the amazon items page, or null.
 */
const handlePriceProcessing = priceArray => {
  for (let index = 0; index < priceArray.length; index += 1) {
    const price = priceArray[index];
    if (price) return price;
  }
  return null;
};

// public
const getGoodreadsBookData = async isbn => {
  console.debug('Fetching Goodreads book data...');
  const bookDataXml = await fetchData(
    `https://www.goodreads.com/book/isbn/${isbn}?key=sVmSxKa1t7JkqEOXppzIQ`
  );

  let jsonBookData = convert.xml2json(bookDataXml, {
    compact: true,
    spaces: 4
  });

  jsonBookData = JSON.parse(jsonBookData);

  const { GoodreadsResponse } = jsonBookData;

  const { book } = GoodreadsResponse;
  const { popular_shelves: popularShelves } = book;
  const { shelf } = popularShelves;

  const toReadShelf = shelf[0];
  const { _attributes: toReadData } = toReadShelf;
  const { name: toReadShelfName, count: toReadCount } = toReadData;
  let peopleToReadBook = null;
  if (toReadShelfName === TO_READ) {
    peopleToReadBook = toReadCount;
  }

  const currentlyReading = shelf[1];
  const { _attributes: currentlyReadingData } = currentlyReading;
  const { name: currentlyReadingShelfName, count } = currentlyReadingData;
  let peopleCurrentlyReadingBook = null;
  if (currentlyReadingShelfName === CURRENTLY_READING) {
    peopleCurrentlyReadingBook = count;
  }

  const { authors, average_rating: avgRating, title } = book;
  const { _cdata: bookTitle } = title;
  const { author } = authors;
  const { name } = author[0] || author;
  const { _text: avgRatingText } = avgRating;
  const { _text: authorName } = name;

  const bookData = {
    title: bookTitle,
    author: authorName,
    avgRating: avgRatingText,
    toRead: peopleToReadBook,
    currentlyReading: peopleCurrentlyReadingBook
  };
  return bookData;
};

const fetchData = url =>
  new Promise((resolve, reject) => {
    request(url, (error, response, body) => {
      if (error || response.statusCode !== 200) {
        console.debug('SERVER error fetching data');
        /* eslint-disable-next-line prefer-promise-reject-errors */
        return reject(null);
      }
      return resolve(body);
    });
  });

server.get('/api/amazonuk', async (req, res) => {
  const { query } = req;
  const { asin } = query;

  await getAmazonProductInfo(asin).then(
    productInformation => {
      res.status(200).json(productInformation);
    },
    () => {
      res.status(500);
    }
  );
});

server.get('/api/goodreads', async (req, res) => {
  const { query } = req;
  const { isbn } = query;
  await getGoodreadsBookData(isbn).then(
    result => {
      res.status(200).json(result);
    },
    () => {
      console.debug('SERVER error fetching goodreads info');
      res.status(500);
    }
  );
});

module.exports = Webtask.fromExpress(server);
