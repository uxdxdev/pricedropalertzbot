'use latest';
import * as firebaseModule from 'firebase-admin';
import request from 'request';
import TwitModule from 'twit';
import 'babel-polyfill';

let ENV = null;
let firebase = null;
let twit = null;

export const readAllItems = () =>
  firebase
    .database()
    .ref()
    .child('items')
    .once('value')
    .then(snapshot => snapshot.val());

export const createItem = item =>
  firebase
    .database()
    .ref()
    .child(`items/${item.asin}`)
    .set(item);

const handlePriceChecking = () => {
  console.log('ANALYSER Price check started...');
  readAllItems()
    .then(trackerList => {
      let delay = 0;

      Object.keys(trackerList).forEach(asin => {
        delay += 1;

        setTimeout(async () => {
          const currentItemInformation = await requestItemInfoFromAmazonService(
            asin
          );
          if (currentItemInformation !== null) {
            // successfully got amazon page info
            const {
              asin: currentAsin,
              price: currentPrice
            } = currentItemInformation;

            // get stored info for item
            const storedItemInformation = trackerList[asin];
            const {
              asin: storedAsin,
              price: storedPrice,
              isbn10,
              isbn13,
              title
            } = storedItemInformation;

            // compare the prices of the stored item and the current information from amazon
            const currentPriceNumber = Number(currentPrice);
            const storedPriceNumber = Number(storedPrice);
            if (
              currentAsin === storedAsin &&
              currentPriceNumber <= storedPriceNumber * 0.9
            ) {
              // set lower price for alert
              // storedItemInformation.price = currentPriceNumber;
              // price drop by 10%+
              // priceAlertMap[asin] = storedItemInformation;

              console.log(
                'Price drop alert 🚨 asin',
                asin,
                'was',
                storedPrice,
                'now',
                currentPrice
              );

              // if the item is a book get the good reads data
              if (isbn10 || isbn13) {
                let bookData = null;
                if (isbn10) {
                  bookData = await requestGoodreadsBookData(isbn10);
                } else if (isbn13) {
                  bookData = await requestGoodreadsBookData(isbn13);
                }
                if (bookData) {
                  const {
                    authorName,
                    averageRatingString,
                    toReadString,
                    currentlyReadingString
                  } = bookData;

                  const status = `${title} by ${authorName} is now £${currentPrice} 👀\n\n📚 #Goodreads${averageRatingString}${toReadString}${currentlyReadingString}\n\nBuy now at 👉 amazon.co.uk/gp/product/${asin}/?tag=${
                    process.env.AMAZON_AFFILIATE_ID
                  }`;
                  tweetStatus(status);
                }
              } else {
                // no isbn available
                const status = `${title} is now £${currentPrice} 👀\n\nBuy now at 👉 amazon.co.uk/gp/product/${asin}/?tag=${
                  process.env.AMAZON_AFFILIATE_ID
                }`;
                tweetStatus(status);
              }
            }

            // update the current price of the item in the database if it is not the same as the stored information
            if (
              currentAsin === storedAsin &&
              currentPriceNumber !== storedPriceNumber
            ) {
              // item was on sale when we started tracking so we need to update
              // the price to the more expensive reading to accuratly track price
              // drops in the future
              const updatedItemInformation = Object.assign(
                storedItemInformation,
                { price: currentPrice }
              );
              createItem(updatedItemInformation);
              console.log(
                `ANALYSER Updating ${asin} the price was ${storedPrice} now ${currentPrice}`
              );
            }
          } else {
            console.log('ANALYSER Error problem gettting amazon product info');
          }
          // delay between requests to Amazon UK for price
        }, 5000 * delay);
      });
    })
    .catch(() => console.log('ANALYSER Error reading items from firebase'));
};

const tweetStatus = status => {
  console.log('🚀 Tweeting status ⚡️', status);
  twit.post('statuses/update', { status }, err => {
    if (err) {
      console.log('Error statuses/update: Duplicate tweet.');
    }
  });
};

const requestItemInfoFromAmazonService = asin => {
  return new Promise((resolve, reject) => {
    request(ENV.API_AMAZON_UK_INFO + asin, (err, response, body) => {
      if (err) {
        console.debug('ANALYSER requestItemInfoFromAmazonService error');
        return reject();
      }

      const item = JSON.parse(body);
      return resolve(item);
    });
  });
};

const requestGoodreadsBookData = isbn => {
  return new Promise((resolve, reject) => {
    request(ENV.API_GOODREADS_BOOK_DATA + isbn, (err, response, body) => {
      if (err) {
        console.debug('ANALYSER requestGoodreadsBookData() error');
        return reject();
      }

      const item = JSON.parse(body);
      return resolve(item);
    });
  });
};

/**
 * @param context {WebtaskContext}
 */
module.exports = function(context, cb) {
  ENV = context.secrets;

  if (twit === null) {
    const twitterAppConfig = {
      consumer_key: ENV.CONSUMER_KEY,
      consumer_secret: ENV.CONSUMER_SECRET,
      access_token: ENV.ACCESS_TOKEN,
      access_token_secret: ENV.ACCESS_TOKEN_SECRET,
      timeout_ms: 60 * 1000 // optional HTTP request timeout to apply to all requests.
    };

    twit = new TwitModule(twitterAppConfig);
  }

  if (firebase === null) {
    const config = {
      apiKey: ENV.REACT_APP_FIREBASE_API_KEY,
      authDomain: ENV.REACT_APP_FIREBASE_AUTH_DOMAIN,
      databaseURL: ENV.REACT_APP_FIREBASE_DATABASE_URL,
      projectId: ENV.REACT_APP_FIREBASE_PROJECT_ID,
      storageBucket: '',
      messagingSenderId: ENV.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
      clientEmail: ENV.REACT_APP_FIREBASE_CLIENT_EMAIL,
      privateKey: ENV.REACT_APP_FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };

    firebaseModule.initializeApp({
      credential: firebaseModule.credential.cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey
      }),
      databaseURL: config.databaseURL
    });

    firebase = firebaseModule;
  }

  handlePriceChecking();

  cb(null, { msg: 'done' });
};
