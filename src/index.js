const cluster = require('cluster');

const config = require('./config.json');

const {Logger} = require('./logger');
const {DB} = require('./db');
const {Bot} = require('./bot');
const {TaskManager} = require('./task-manager');
const {getManyVersions} = require('./github-client');


const logger = new Logger(config.app.logs);
const tasks = new TaskManager();

const workers = process.env.WORKERS || 1;

process.on('uncaughtException', (err) => {
  logger.error(`uncaughtException: ${err.message}`);
  logger.error(err.stack.toString());
});

const run = async () => {
  logger.log('Worker initializing');

  const db = new DB(config.mongodb.url, config.mongodb.name);

  try {
    await db.init();
  } catch (error) {
    logger.error(error);
  }

  const bot = new Bot(db);

  const updateReleasesTask = async () => {
    const repos = await db.getAllRepos();

    const updates = await getManyVersions(repos.map(({owner, name}) => ({owner, name})), 1);

    return await db.updateRepos(updates);
  };

  tasks.add('releases', updateReleasesTask, config.app.updateInterval || 60 * 5);
  tasks.subscribe('releases', bot.notifyUsers.bind(bot));

  logger.log('Worker ready');
};


const forkWorker = (cluster) => {
  const worker = cluster.fork().process;

  logger.log(`Worker ${worker.pid} started.`);
};

if (cluster.isMaster) {
  logger.log(`Start cluster with ${workers} workers`);

  for (let i = workers; i--;) {
    forkWorker(cluster)
  }

  cluster.on('exit', (worker) => {
    const timeout = config.app.restartRate;

    logger.log(`Worker ${worker.process.pid} died. Restart after ${timeout}s...`);

    setTimeout(() => forkWorker(cluster), timeout);
  });
} else {
  run();
}
