const config = require('./config.json');
const {MongoDB} = require('./mongo-db');
const {Bot} = require('./bot');
const tasks = require('./tasks');
const client = require('./github-client');


const main = async () => {
  const db = new MongoDB(config.mongodb.url, config.mongodb.name);

  await db.init();

  const bot = new Bot(db);

  const updateReleasesTask = async () => {
    const repos = await db.getAllRepos();

    const updates = await client.getManyVersions(repos.map(({owner, name}) => ({owner, name})), 1);

    await db.updateRepos(updates);

    return repos;
  };

  tasks.add('releases', updateReleasesTask, 60);
  tasks.subscribe('releases', bot.notifyUsers.bind(bot));
};


main();
