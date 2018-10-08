'use latest';
import TwitModule from 'twit';
import request from 'request';
import 'babel-polyfill';
import * as firebaseModule from 'firebase-admin';

let ENV = null;
let storage = null;
let twit = null;
let firebase = null;

const FIVE_SECONDS = 5000;

const URL_FRIENDSHIPS_CREATE = 'friendships/create';
const URL_DIRECT_MESSAGES_NEW = 'direct_messages/events/new';
const URL_DIRECT_MESSAGES_LIST = 'direct_messages/events/list';

let currentFollowersSet = null;
let currentFriendsSet = null;

export const readItem = asin =>
  firebase
    .database()
    .ref()
    .child(`items/${asin}`)
    .once('value');

export const readTracker = userId =>
  firebase
    .database()
    .ref()
    .child(`trackers/${userId}`)
    .once('value');

export const createItem = item =>
  firebase
    .database()
    .ref()
    .child(`items/${item.asin}`)
    .set(item);

export const createTracker = tracker =>
  firebase
    .database()
    .ref()
    .child(`trackers/${tracker.userId}`)
    .set(tracker);

export const removeTracker = userId =>
  firebase
    .database()
    .ref()
    .child(`trackers/${userId}`)
    .remove();

export const removeItem = itemId =>
  firebase
    .database()
    .ref()
    .child(`items/${itemId}`)
    .remove();

export const removeTrackerFromItem = (userId, itemId) =>
  firebase
    .database()
    .ref()
    .child(`items/${itemId}/trackers/${userId}`)
    .remove();

export const readAllTrackersForItem = itemId =>
  firebase
    .database()
    .ref()
    .child(`items/${itemId}/trackers`)
    .once('value')
    .then(snapshot => snapshot.val());

export const readAllItems = () =>
  firebase
    .database()
    .ref()
    .child('items')
    .once('value')
    .then(snapshot => snapshot.val());

export const checkTrackingStatus = (asin, userId) =>
  firebase
    .database()
    .ref()
    .child(`trackers/${userId}/tracking/${asin}`)
    .once('value');

const followEvent = (userId, delayOffset = 1) => {
  setTimeout(() => {
    twit.post(
      URL_FRIENDSHIPS_CREATE,
      {
        user_id: userId,
        follow: true
      },
      (err, result) => {
        if (err) {
          console.error('error followEventCallback()', err);
        } else if (result) {
          const { screen_name: screenName, name, id_str } = result;
          console.debug(`Successfully followed ${screenName} 💪💪`);
          const message = generateMessage(name);
          dmEvent(id_str, message);
        }
      }
    );
  }, 1000 * delayOffset);
};

const dmEvent = (userId, message) => {
  twit.post(
    URL_DIRECT_MESSAGES_NEW,
    {
      event: {
        type: 'message_create',
        message_create: {
          target: {
            recipient_id: userId
          },
          message_data: {
            text: message
          }
        }
      }
    },
    (err, result) => {
      if (err) {
        console.error('Error direct_messages/events/new', err);
      } else if (result) {
        console.debug(`Direct message sent successfully to ${userId} 💪💪`);
      }
    }
  );
};

const generateMessage = name => {
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
  ];
  const d = new Date();
  const dayName = days[d.getDay()];
  return `👋 Hi ${name} Thanks for the follow! 🎉 I'm following you back right now! 🚀\n\nIf you have any suggestions for new features send @Beautifwhale a message.\n\nIf you want me to track an Amazon UK item for you please direct message me a link to the item and I'll see what I can do 😎 Happy ${dayName}!`; // your message
};

let friendsCursor = -1;
let followersCursor = -1;

const checkFollowerFriendParity = () => {
  const promises = [
    new Promise((resolveFriends, rejectFriends) => {
      if (friendsCursor === 0) friendsCursor = -1; // reset to the first page
      twit.get(
        'friends/ids',
        {
          screen_name: ENV.USERNAME,
          cursor: friendsCursor,
          stringify_ids: true
        },
        (err, friends) => {
          if (err) return rejectFriends();
          const { next_cursor: nextCursor } = friends;
          const { ids } = friends;
          friendsCursor = nextCursor;
          return resolveFriends({ friends: ids });
        }
      );
    }),
    new Promise((resolveFollowers, rejectFollowers) => {
      if (followersCursor === 0) followersCursor = -1; // reset to the first page
      twit.get(
        'followers/ids',
        {
          screen_name: ENV.USERNAME,
          cursor: followersCursor,
          stringify_ids: true
        },
        (err, followers) => {
          if (err) return rejectFollowers();
          const { next_cursor: nextCursor } = followers;
          const { ids } = followers;
          followersCursor = nextCursor;
          return resolveFollowers({ followers: ids });
        }
      );
    })
  ];

  Promise.all(promises).then(async data => {
    const { friends } = data[0];
    const { followers } = data[1];
    if (friends && friends.length > 0 && followers && followers.length > 0) {
      currentFollowersSet = new Set(followers);
      // save to storage
      storage.set({ currentFollowersSet }, { force: 1 }, () => {
        // error pushing data to storage
      });

      currentFriendsSet = new Set(friends);

      // unfollow current friends
      let delayOffset = 1;
      friends.forEach(friendId => {
        if (!currentFollowersSet.has(friendId)) {
          unfollowEvent(friendId, delayOffset);
          delayOffset += 1;
        }
      });

      // follow current followers
      delayOffset = 1;
      followers.forEach(followerId => {
        if (!currentFriendsSet.has(followerId)) {
          followEvent(followerId, delayOffset);
          delayOffset += 1;
        }
      });
    }
  });
};

const unfollowEvent = (friendId, delayOffset = 1) => {
  setTimeout(() => {
    twit.post(
      'friendships/destroy',
      {
        user_id: friendId
      },
      (err, result) => {
        if (err) {
          console.error('BOT error friendships/destroy', err);
        } else if (result) {
          console.debug(`😞 Successfully unfollowed ${friendId} 💪.`);
          handleRemoveTracker(friendId);
        }
      }
    );
  }, 1000 * delayOffset);
};

const getDirectMessages = () => {
  return new Promise((resolve, reject) => {
    twit.get(
      URL_DIRECT_MESSAGES_LIST,
      {
        screen_name: ENV.USERNAME,
        stringify_ids: true
      },
      (err, result) => {
        if (err) {
          console.error('Error direct_messages/events/list');
          reject(null);
        } else if (result) {
          resolve(result);
        }
      }
    );
  });
};

const handleTrackItem = (asin, userId) => {
  return new Promise(async (resolve, reject) => {
    // check if already being tracked
    const trackingItem = await checkTrackingStatus(asin, userId).then(
      snapshot => snapshot.val(),
      () => {
        console.debug('BOT error checking tracking status');
      }
    );
    if (trackingItem) {
      // item is already being tracked
      return reject();
    }

    // check if item exists
    const itemExists = await readItem(asin).then(
      snapshot => snapshot.val(),
      () => {
        console.debug('BOT error reading item from DB');
      }
    );

    if (itemExists === null) {
      // item does not exist create new item and add this tracker to the trackers list
      const trackers = {};
      trackers[userId] = true;

      // get item information
      const item = await requestItemInfoFromAmazonService(asin).catch(() => {
        // the amazon service
        return reject();
      });
      const updatedItem = Object.assign(item, { trackers });
      await createItem(updatedItem).then(
        () => {
          console.debug('item created in DB');
        },
        () => {
          // an error occured creating the item in the database end processing
          return reject();
        }
      );
    } else {
      // item exists get the trackers list and add the new user
      const { trackers } = itemExists;
      trackers[userId] = true;
      await createItem(itemExists).catch(() => {
        // an error occured creating the item in the database end processing
        return reject();
      });
    }

    // check if tracker exists
    const trackerExists = await readTracker(userId).then(snapshot =>
      snapshot.val()
    );

    if (trackerExists === null) {
      // tracker does not exist create new tracker
      const tracking = {};
      tracking[asin] = true;
      const tracker = {
        userId,
        tracking
      };
      await createTracker(tracker).catch(() => {
        // an error occured creating the tracker in the database end processing
        return reject();
      });
    } else {
      // tracker exists update existing tracker record with new item
      const { tracking } = trackerExists;
      tracking[asin] = true;
      const updatedTracker = Object.assign(trackerExists, { tracking });
      await createTracker(updatedTracker).catch(() => {
        // an error occured creating the tracker in the database end processing
        return reject();
      });
    }
    // database updated successfully
    resolve();
  });
};

const requestItemInfoFromAmazonService = asin => {
  return new Promise((resolve, reject) => {
    request(ENV.API_AMAZON_UK_INFO + asin, (err, response, body) => {
      if (err) {
        console.debug('BOT getAmazonInfo() request() error');
        return reject();
      }

      const item = JSON.parse(body);
      return resolve(item);
    });
  });
};

const handleRemoveTracker = async userId => {
  const tracker = await readTracker(userId).then(snapshot => snapshot.val());
  if (tracker === null) {
    console.debug('Error removing tracker data, no tracker data exists');
    return null;
  }

  const { tracking } = tracker;
  Object.keys(tracking).forEach(async itemId => {
    await removeTrackerFromItem(userId, itemId).catch(() =>
      console.debug('Error removing tracker from item')
    );
    // if item has no trackers delete it
    const trackersForItem = await readAllTrackersForItem(itemId);
    if (trackersForItem === null) {
      removeItem(itemId);
    }
  });
  const data = await removeTracker(userId)
    .then(() => true)
    .catch(() => {
      console.debug('Error removing tracker');
      return false;
    });
  return data;
};

const handleDirectMessageTrackingRequests = async () => {
  // get list of direct messages
  const directMessageList = await getDirectMessages().catch(() =>
    console.debug('error fetching direct messages')
  );
  if (directMessageList) {
    const { events } = directMessageList;
    let delayTimeout = 1;

    // get followers from storage
    storage.get((error, data) => {
      if (error) {
        console.debug('error retrieving data from storage');
        return null;
      }
      const { currentFollowersSet: followers } = data;
      const currentFollowersSetFromStorage = new Set(followers);
      events.forEach(async event => {
        const { message_create } = event;
        const { message_data, sender_id } = message_create;
        const { entities } = message_data;
        const { urls } = entities;
        const urlData = urls[0];
        if (urlData) {
          const { expanded_url } = urlData;
          const matchArray = expanded_url.match(
            '/([a-zA-Z0-9]{10})(?:[/? ]|$)'
          );
          const asin = matchArray[1];
          // check if sender is still a follower and sender is not this bot

          if (
            currentFollowersSetFromStorage &&
            currentFollowersSetFromStorage.has(sender_id) &&
            sender_id !== ENV.TWITTER_ACCOUNT_ID
          ) {
            // for each valid request handle tracking with a delay
            setTimeout(() => {
              handleTrackItem(asin, sender_id).then(
                () => dmEvent(sender_id, `Boom! Tracking your item now`),
                () => {
                  // already tracking item for user or amazon server encountered an error
                }
              );
            }, FIVE_SECONDS * delayTimeout);
            delayTimeout += 1;
          } else {
            // currentFollowersSet null or sender is not a follower
            console.debug('sender is not a follower, nothing left to do');
          }
        }
      });
    });
  } else {
    console.debug('no direct messages list fetched');
  }
};

module.exports = (context, cb) => {
  ENV = context.secrets;
  storage = context.storage;

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

  checkFollowerFriendParity();
  handleDirectMessageTrackingRequests();
  // check each item in the database to see if the price has fallen
  cb(null, { msg: 'done ' });
};
