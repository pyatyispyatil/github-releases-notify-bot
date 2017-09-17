const Telegraf = require('telegraf');
const config = require('./config.json');
const {Router, Extra, memorySession, Markup} = require('telegraf');

const {getVersions} = require('./github-client');

const API_TOKEN = config.telegram.token || '';
const PORT = config.server.port || 8443;
const URL = config.server.url || '';

const getUser = (ctx) => ctx.message ? ctx.message.from : ctx.update.callback_query.from;

const getReleaseMessage = (repo, release) =>
  `*${repo.owner}/${repo.name}*
[${release.name}](${release.url})
${release.description
    .replace(/\*/mgi, '')
    .replace(/_/mgi, '\\_')
    .trim()}`;

class Bot {
  constructor(db) {
    const bot = new Telegraf(API_TOKEN);

    this.bot = bot;
    this.db = db;

    this.bot.use(memorySession());

    this.bot.telegram.getMe().then((botInfo) => {
      this.bot.options.username = botInfo.username;
    });

    // bot.telegram.setWebhook(URL);
    // bot.startWebhook('/', null, PORT);

    this.listen();

    bot.startPolling();
  }

  listen() {
    this.bot.command('start', this.start.bind(this));
    this.bot.command('actions', this.actions.bind(this));

    this.bot.action('actions:button:addRepo', this.actionAddRepo.bind(this));
    this.bot.action('actions:button:editRepos', this.actionEditRepos.bind(this));
    this.bot.action('actions:button:getReleases', this.actionGetReleases.bind(this));

    this.bot.action(/editRepos:delete:(.+)/, this.editReposDelete.bind(this));

    this.bot.hears(/.+/, this.handleAnswer.bind(this));

    this.bot.startPolling();
  }

  notifyUsers(repos) {
    //ToDo: user notify
  };

  parseRepo(str) {
    let owner, name;

    if (str) {
      const isUrl = /https?:\/\//.test(str);

      if (isUrl) {
        [, owner, name] = str.match(/https?:\/\/github\.com\/(.*?)\/(.*?)\/?$/i);
      } else {
        [owner, name] = str.split('/');
      }
    }

    if (owner && name) {
      return {owner, name};
    } else {
      return null;
    }
  }

  async start(ctx) {
    const user = getUser(ctx);

    await this.db.createUser(user);

    return this.actions(ctx);
  }

  async handleAnswer(ctx, next) {
    const str = ctx.match[0];
    const user = getUser(ctx);

    if (ctx.session.action) {
      switch (ctx.session.action) {
        case 'addRepo':
          const repo = this.parseRepo(str);
          if (repo) {
            try {
              const status = await this.db.bindUserToRepo(user.id, repo.owner, repo.name);

              if (status === 'new') {
                const releases = await getVersions(repo.owner, repo.name, 10);

                await this.db.updateRepo(repo.owner, repo.name, releases);
              }

              ctx.session.action = null;
              return ctx.reply('Done!');
            } catch (err) {
              return ctx.reply('Something was wrong. Please, try again.');
            }
          } else {
            return ctx.reply('Cannot subscribe to this repo. Please enter another:');
          }
        default:
          ctx.session.action = null;
          return next();
      }
    }
  }

  actionAddRepo(ctx) {
    ctx.session.action = 'addRepo';

    return ctx.editMessageText('Please, enter the owner and name of repo (owner/name) or full url');
  }

  async actionEditRepos(ctx) {
    const {subscriptions} = await this.db.getUser(getUser(ctx).id);

    if (subscriptions && subscriptions.length) {
      return ctx.editMessageText(
        'Your repos',
        Extra.HTML().markup((m) => {
          const row = (repo) => [
            m.urlButton(`${repo.owner}/${repo.name}`, `https://github.com/${repo.owner}/${repo.name}`),
            m.callbackButton('🗑️', `editRepos:delete:${repo.owner}/${repo.name}`)
          ];

          return m.inlineKeyboard(subscriptions.map(row));
        })
      );
    } else {
      ctx.editMessageText('You do not have a subscriptions');
    }
  }

  async editReposDelete(ctx) {
    const user = getUser(ctx);
    const [owner, name] = ctx.match[1].split('/');

    await this.db.unbindUserFromRepo(user.id, owner, name);

    return this.actionEditRepos(ctx);
  }

  async actionGetReleases(ctx, next) {
    const repos = await this.db.getUserSubscriptions(getUser(ctx).id);

    return repos.reduce((promise, repo) => {
      const lastRelease = repo.releases[repo.releases.length - 1];

      return promise.then(() => ctx.replyWithMarkdown(getReleaseMessage(repo, lastRelease)));
    }, Promise.resolve());
  }

  actions(ctx) {
    return ctx.reply('Select an action', Extra.HTML().markup((m) =>
      m.inlineKeyboard([
        m.callbackButton('Add repo', 'actions:button:addRepo'),
        m.callbackButton('Edit repos list', 'actions:button:editRepos'),
        m.callbackButton('Get latest releases', 'actions:button:getReleases')
      ])));
  }
}

module.exports = {
  Bot
};
