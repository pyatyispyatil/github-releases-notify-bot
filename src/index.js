const config = require('./config.json');
const {MongoDB} = require('./mongo-db');
const {Bot} = require('./bot');
const tasks = require('./tasks');


async function main() {
  const mongo = new MongoDB(config.mongodb.url, config.mongodb.name);

  await mongo.init();

  tasks.add('releases', )

  const bot = new Bot(mongo);
}


main();
