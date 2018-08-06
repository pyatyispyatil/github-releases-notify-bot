const Telegraf = require('telegraf');
const {Extra, Markup, memorySession} = require('telegraf');
const SocksProxyAgent = require('socks-proxy-agent');

const keyboards = require('./keyboards');
const config = require('../config.json');
const {about, greeting, stats} = require('./texts');
const {getUser, parseRepo, getLastReleasesInRepos, getReleaseMessages} = require('./utils');
const {getVersions} = require('./github-client');


const API_TOKEN = config.telegram.token || '';
const PROXY_OPTIONS = config.telegram.proxy || '';

const PREVIEW_RELEASES_COUNT = -10;
const FIRST_UPDATE_RELEASES_COUNT = 20;
const UPDATE_INTERVAL = Math.floor((config.app.updateInterval / 60) * 100) / 100;


class Bot {
  constructor(db, logger) {
    this.bot = new Telegraf(API_TOKEN, {
      telegram: PROXY_OPTIONS ? {
        agent: new SocksProxyAgent(PROXY_OPTIONS)
      } : {},
      channelMode: false
    });
    this.db = db;
    this.logger = logger;

    this.bot.use(memorySession({
      getSessionKey: (ctx) => `${ctx.chat && ctx.chat.id}`
    }));
    this.bot.catch((err) => {
      this.logger.error(err);
    });

    this.bot.telegram.getMe().then((botInfo) => {
      this.bot.options.username = botInfo.username;
    });

    this.listen();

    this.logger.log('Bot listen');
  }

  listen() {
    const commands = [
      ['start', this.start],
      ['actions', this.actions],
      ['about', this.about],
      ['admin', this.admin]
    ];
    const actions = [
      ['actionsList', this.actionsList],
      ['adminActionsList', this.adminActionsList],
      ['addRepo', this.addRepo],
      ['getReleases', this.getReleases],
      [/^getReleases:expand:(.+)$/, this.getReleasesExpandRelease],
      ['getReleases:all', this.getReleasesAll],
      ['getReleases:one', this.getReleasesOne],
      [/^getReleases:one:(\d+)$/, this.getReleasesOneRepo],
      [/^getReleases:one:(\d+?):release:(\d+?)$/, this.getReleasesOneRepoRelease],
      ['editRepos', this.editRepos],
      [/^editRepos:delete:(.+)$/, this.editReposDelete],
      ['sendMessage', this.sendMessage],
      ['getStats', this.getStats]
    ];

    commands.forEach(([command, fn]) => this.bot.command(command, this.wrapAction(fn)));
    actions.forEach(([action, fn]) => this.bot.action(action, this.wrapAction(fn)));

    this.bot.hears(/.+/, this.wrapAction(this.handleAnswer));

    this.bot.startPolling();
  }

  wrapAction(action) {
    return async (...args) => {
      try {
        return await action.apply(this, args);
      } catch (error) {
        this.logger.error(`uncaughtException: ${error.message}`);
        this.logger.error(error.stack.toString());
      }
    }
  }

  async notifyUsers(repos) {
    await this.sendReleases(
      null,
      repos,
      async (markdown, key, {watchedUsers}) => {
        await Promise.all(watchedUsers.map(async (userId) => {
          try {
            await this.bot.telegram.sendMessage(userId, markdown, Extra.markdown());
          } catch (error) {
            this.logger.error(`Cannot send releases to user: ${userId}`);
            this.logger.error(error.stack.toString());
          }
        }));
      }
    );
  };

  async start(ctx) {
    await ctx.reply(greeting());

    return await this.actions(ctx);
  }

  async actions(ctx) {
    ctx.session.action = null;

    const user = getUser(ctx);

    await this.db.createUser(user);

    return ctx.reply('Select an action', keyboards.actionsList());
  }

  admin(ctx) {
    return this.checkAdminPrivileges(ctx, () => {
      return ctx.reply('Select an action', keyboards.adminActionsList());
    });
  }

  about(ctx) {
    return ctx.replyWithMarkdown(about(UPDATE_INTERVAL));
  }

  async handleAnswer(ctx, next) {
    const str = ctx.match[0];
    const user = getUser(ctx);

    if (ctx.session.action) {
      switch (ctx.session.action) {
        case 'addRepo':
          const repo = parseRepo(str);

          if (repo) {
            const hasRepoInDB = await this.db.getRepo(repo.owner, repo.name);

            if (!hasRepoInDB) {
              try {
                const releases = await getVersions(repo.owner, repo.name, FIRST_UPDATE_RELEASES_COUNT);

                await this.db.addRepo(repo.owner, repo.name);
                await this.db.updateRepo(repo.owner, repo.name, releases);
              } catch (error) {
                return ctx.reply('Cannot subscribe to this repo. Please enter another:');
              }
            }

            await this.db.bindUserToRepo(user.id, repo.owner, repo.name);

            ctx.session.action = null;

            return ctx.reply('Done! Add one more?', keyboards.addOneMoreRepo());
          } else {
            return ctx.reply('Cannot subscribe to this repo. Please enter another:');
          }
        case 'sendMessage':
          return this.checkAdminPrivileges(ctx, async () => {
            const users = await this.db.getAllUsers();

            await Promise.all(users.map(async ({userId, username, firstName, lastName}) => {
              try {
                await this.bot.telegram.sendMessage(userId, ctx.match.input, Extra.markdown())
              } catch (err) {
                this.logger.error(`Cannot send message to user: ${userId} | ${username} | ${firstName} | ${lastName}`);
              }
            }));

            ctx.session.action = null;

            return ctx.reply('Message sent');
          });
        default:
          ctx.session.action = null;
          return next();
      }
    }
  }

  addRepo(ctx) {
    ctx.session.action = 'addRepo';

    ctx.answerCallbackQuery('');

    return this.editMessageText(ctx, 'Please, send me the owner and name of repo (owner/name) or full url', keyboards.backToActions());
  }

  async editRepos(ctx) {
    const {subscriptions} = await this.db.getUser(getUser(ctx).id);

    ctx.answerCallbackQuery('');

    if (subscriptions && subscriptions.length) {
      const row = (repo) => [
        Markup.urlButton(`${repo.owner}/${repo.name}`, `https://github.com/${repo.owner}/${repo.name}`),
        Markup.callbackButton('🗑️', `editRepos:delete:${repo.owner}/${repo.name}`)
      ];

      return this.editMessageText(ctx,
        'Your subscriptions',
        Markup.inlineKeyboard([...subscriptions.map(row), [Markup.callbackButton('Back', `actionsList`)]]).extra()
      );
    } else {
      this.editMessageText(ctx,
        'You do not have a subscriptions',
        keyboards.backToActions()
      );
    }
  }

  async editReposDelete(ctx) {
    const user = getUser(ctx);
    const [owner, name] = ctx.match[1].split('/');

    await this.db.unbindUserFromRepo(user.id, owner, name);

    return this.editRepos(ctx);
  }

  async getReleases(ctx) {
    ctx.answerCallbackQuery('');

    return this.editMessageText(ctx, 'What list do you want to see?', keyboards.allOrOneRepo());
  }

  async getReleasesAll(ctx) {
    const repos = await this.db.getUserSubscriptions(getUser(ctx).id);

    ctx.answerCallbackQuery('');

    return this.sendReleases(
      ctx,
      repos.map(getLastReleasesInRepos),
      ctx.replyWithHTML
    );
  }

  async getReleasesOne(ctx) {
    const {subscriptions} = await this.db.getUser(getUser(ctx).id);

    ctx.session.subscriptions = subscriptions;

    ctx.answerCallbackQuery('');

    return this.editMessageText(ctx,
      'Select repository',
      keyboards.table(
        'getReleases',
        'getReleases:one',
        subscriptions.map(({owner, name}) => `${owner}/${name}`)
      )
    )
  }

  async getReleasesOneRepo(ctx) {
    ctx.answerCallbackQuery('');

    const index = parseInt(ctx.match[1]);

    if (ctx.session.subscriptions && ctx.session.subscriptions[index]) {
      const {owner, name} = ctx.session.subscriptions[index];

      const repo = await this.db.getRepo(owner, name);

      const result = this.editMessageText(ctx,
        'Select release',
        keyboards.table(
          `getReleases:one`,
          `getReleases:one:${index}:release`,
          repo.releases.slice(PREVIEW_RELEASES_COUNT).map(({name, isPrerelease}) => `${name}${isPrerelease ? ' (pre-release)' : ''}`)
        )
      );

      return this.checkForExeption(ctx, result);
    }
  }

  async getReleasesOneRepoRelease(ctx) {
    ctx.answerCallbackQuery('');

    try {
      const repoIndex = parseInt(ctx.match[1]);
      const releaseIndex = parseInt(ctx.match[2]);

      if (ctx.session.subscriptions && ctx.session.subscriptions[repoIndex]) {
        const {owner, name} = ctx.session.subscriptions[repoIndex];

        const repo = await this.db.getRepo(owner, name);

        return this.sendReleases(
          null,
          [Object.assign(repo, {releases: [repo.releases.slice(PREVIEW_RELEASES_COUNT)[releaseIndex]]})],
          ctx.replyWithMarkdown
        );
      }
    } catch (error) {
      return this.dataBrokenException(ctx);
    }
  }

  async getReleasesExpandRelease(ctx) {
    const data = ctx.match[1];

    ctx.answerCallbackQuery('');

    const index = parseInt(data);
    const releases = ctx.session.releasesDescriptions;

    if (releases && releases[index]) {
      if (releases[index].length <= 1) {
        const result = await this.editMessageText(ctx, releases[index][0], Extra.markdown());

        return this.checkForExeption(ctx, result);
      } else {
        return releases[index]
          .reduce((promise, message) => promise
            .then(() => ctx.replyWithMarkdown(message, Extra.markdown())),
            ctx.deleteMessage(ctx.update.callback_query.id));
      }
    } else {
      return this.dataBrokenException(ctx);
    }
  }

  async sendReleases(ctx, repos, send) {
    if (ctx) {
      ctx.session.releasesDescriptions = [];
    }

    return repos.reduce((promise, repo) => {
      const sendRelease = this.getReleaseSender(ctx, repo, send);

      return repo.releases.reduce((stream, release) =>
          stream.then(() => sendRelease(stream, release)),
        promise);
    }, Promise.resolve());
  }

  actionsList(ctx) {
    ctx.answerCallbackQuery('');

    return this.editMessageText(ctx, 'Select an action', keyboards.actionsList());
  }

  adminActionsList(ctx) {
    ctx.answerCallbackQuery('');

    return this.editMessageText(ctx, 'Select an action', keyboards.adminActionsList());
  }

  sendMessage(ctx) {
    return this.checkAdminPrivileges(ctx, () => {
      ctx.session.action = 'sendMessage';

      ctx.answerCallbackQuery('');

      return this.editMessageText(ctx, 'Please send me a message that will be sent to all users', keyboards.backToAdminActions());
    });
  }

  async getStats(ctx) {
    return this.checkAdminPrivileges(ctx, async () => {
      const users = await this.db.getAllUsers();
      const repos = await this.db.getAllReposNames();

      const groups = users.filter(({type}) => type === 'group');
      const groupsCount = groups.length;
      const chatsMembersCount = await Promise.all(
        groups
          .map(({userId}) => this.bot.telegram.getChatMembersCount(userId))
      );
      const usersInGroups = chatsMembersCount
        .filter(Number.isInteger)
        .reduce((acc, count) => acc + count);

      const usersCount = users.filter(({type}) => type !== 'group').length;
      const reposCount = repos.length;
      const averageSubscriptionsPerUser = (users.reduce((acc, {subscriptions}) => acc + subscriptions.length, 0) / users.length).toFixed(2);
      const averageWatchPerRepo = (repos.reduce((acc, {watchedUsers = []}) => acc + watchedUsers.length, 0) / repos.length).toFixed(2);

      return ctx.replyWithMarkdown(stats({
        groupsCount,
        usersCount,
        reposCount,
        averageSubscriptionsPerUser,
        averageWatchPerRepo,
        usersInGroups
      }));
    });
  }

  getReleaseSender(ctx, repo, send) {
    return (promise, release) => {
      const {full, short} = getReleaseMessages(repo, release || {});

      if (ctx) {
        ctx.session.releasesDescriptions.push(full);

        const key = keyboards.expandButton(ctx.session.releasesDescriptions.length - 1);

        return promise.then(() => send(short, key, repo));
      } else {
        return full.reduce((stream, message) =>
            stream.then(() => send(message, '', repo)),
          promise);
      }
    };
  }

  dataBrokenException(ctx) {
    try {
      return this.editMessageText(ctx, 'Data is broken');
    } catch (error) {
      return ctx.reply('Data is broken');
    }
  }

  async checkAdminPrivileges(ctx, cb) {
    const user = getUser(ctx);

    if (user.username === config.adminUserName) {
      return cb();
    } else {
      return ctx.reply('You are not an administrator')
    }
  }

  async checkForExeption(ctx, result) {
    return result === null ? this.dataBrokenException(ctx) : result;
  }

  async editMessageText(ctx, ...message) {
    try {
      return await ctx.editMessageText(...message);
    } catch (err) {
      return null;
    }
  }
}

module.exports = {
  Bot
};
