# @PriceDropAlertz Twitter Bot

Built on webtask.io serverless functions with a Firebase backed for storing
tracking records.

The point to building this bot was to see if I could fit all of the
functionality needed into a serverless architecture and the constraints it
presents.

Go and follow the bot here twitter.com/PriceDropAlertz and send it some
items to track! If you want to request a new feature send twitter.com/Beautifwhale a message.

## Info

The project is made up of three JS files each with a collection of functions
that are used to implement the core functionality of the bot. The bot and
analyser are run on a schedule while the API server is invoked on demand. The
backend is a Firebase realtime database used to persist user tracking choices.

- bot.js (runs every 1 minute)
- apiserver.js
- itemanalyser.js (runs every 1 hour)

## bot.js

The `bot.js` file has two main functions, maintain the bots follower to friend
ratio of 1:1 and handle any tracking requests that come through direct messages
from Twitter users.

- `checkFollowerFriendParity()`

When the `bot.js` file is executed the first thing that happens is the followers
and friends of the bot are requested from the Twitter API and a comparison is
made to find; 1) users who recently followed the bot, and 2) users who recently
unfollowed the bot. For new followers a direct message is sent to greet the new
user and to give them basic instructions about how to interact with the bot. For
any users who have recently unfollowed the bot all data about them and their
tracking choices are removed from the database and they are also unfollowed by
the bot.

- `handleDirectMessageTrackingRequests()`

The second feature of the `bot.js` file is to check all direct messages to the
bot from all current followers and to handle the creation of any new item tracking
records. To do this we request a list of all items currently stored in the
Firebase database for a specific follower. If the new item request is already
being tracked for that user we halt and the process ends. If the user is not
already tracking this item we update the database entries for both the `tracker`
and the `item`, we maintain a link between `trackers` and `items` using Twitter
IDs and ASIN. These records are used by the `analyser.js` file to create Tweets
for price alerts.

## itemanalyser.js

The `itemanalyser.js` file has a single feature and that is to cross reference the
current list of items stored in the database with the items price on Amazon. If
there is a change in the price and it is lower than our most recent record we
create a Tweet containing the items information and current price. If the item
price is now greater than out most recent record we update out records and
continue to the next item.

## apiserver.js

The API server is set to respond to requests on demand by exporting
`Webtask.fromExpress(server)`. This tells webtask.io that we want an express
server setup to service HTTP requests. Our `apiserver.js` file has two main
features, the first is to act as an Amazon item information request service, and
the second is to provide Goodreads data on books that are requested by users.
The Amazon item information request service will parse the page for the item and
extract its current price. The Goodreads data service only works with books that
have an ISBN number on the Amazon page and will return user ratings for the book
to be used when customizing Tweet price alerts.
