const config = require('./config.json');
const {MongoDB} = require('./mongo-db');
const {Bot} = require('./bot');

const {getReleases} = require('./github-client');

const log = (data) => console.log(JSON.stringify(data, null, '  '));


async function main() {
  const mongo = new MongoDB(config.mongodb.url, config.mongodb.name);

  await mongo.init();

  const bot = new Bot();
}


main();
