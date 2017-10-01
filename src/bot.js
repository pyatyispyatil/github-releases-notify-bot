const Telegraf = require('telegraf');
const config = require('./config.json');
const {Extra, Markup, memorySession} = require('telegraf');

const {getVersions} = require('./github-client');

const API_TOKEN = config.telegram.token || '';

const PREVIEW_RELEASES_COUNT = -10;
const FIRST_UPDATE_RELEASES_COUNT = 20;
const MAX_MESSAGE_LENGTH = 4096;

const about = `
Bot to notify you about new releases in the repositories that you add to the subscription. New releases are checked every ${config.app.updateInterval / 60} minutes.

*GitHub repository* - [gloooom/github-releases-notify-bot](https://github.com/gloooom/github-releases-notify-bot)

Your wishes for features, as well as comments about bugs can be written [here](https://github.com/gloooom/github-releases-notify-bot/issues).
`;

const greeting = `
Hello!

That bot can notify you about new releases.
To receive a notification, you must subscribe to repos that you would like to observe. 
To do this, click the "Add repository" button.

In addition, you can see the latest releases of your observed repositories. 
To do this, click the "Get Releases" button.
`;

const getUser = (ctx) => ctx.message ? (
  ctx.message.chat || ctx.message.from
) : (
  ctx.update.callback_query.message.chat || ctx.update.callback_query.from
);

const getShortReleaseMessage = (repo, release) =>
  `<b>${repo.owner}/${repo.name}</b> 
${release.isPrerelease ? '<b>Pre-release</b> ' : ''}${release.name}`;

const getFullReleaseMessage = (repo, release) =>
  `*${repo.owner}/${repo.name}*
${release.isPrerelease ? '*Pre-release* ' : ''}[${release.name}](${release.url})
${release.description
    .replace(/\*/mgi, '')
    .replace(/_/mgi, '\\_')
    .trim()}`;

const getReleaseMessages = (repo, release) => ({
  short: getShortReleaseMessage(repo, release),
  full: splitLongMessage(getFullReleaseMessage(repo, release), MAX_MESSAGE_LENGTH)
});


const splitLongMessage = (message, maxLength) => {
  const splitRegExp = new RegExp([
    `([\\s\\S]{1,${maxLength - 1}}([\\n\\r]|$))`,
    `([\\s\\S]{1,${maxLength - 1}}(\\s|$))`,
    `([\\s\\S]{1,${maxLength}})`
  ].join('|'));
  const splitedMessage = [];
  let separableString = message;

  while (separableString.length) {
    const match = separableString.match(splitRegExp);

    if (match) {
      splitedMessage.push(match[0]);
      separableString = separableString.substr(match[0].length);
    }
  }

  return splitedMessage;
};

const parseRepo = (str) => {
  const githubRegexp = /https?:\/\/github\.com\/(.*?)\/(.*?)\/?$/i;
  let owner, name;

  try {
    if (str && typeof str === 'string') {
      const match = str.match(githubRegexp);

      if (match) {
        [, owner, name] = match;
      } else {
        [owner, name] = str.replace(' ', '').split('/');
      }
    }

    if (owner && name) {
      return {owner, name};
    } else {
      return null;
    }
  } catch (err) {
    return null;
  }
};

const getLastReleasesInRepos = (repo) => {
  const revertedReleases = repo.releases.slice().reverse();

  const last = revertedReleases[0];
  const lastRelease = revertedReleases.find((release) => !release.isPrerelease);
  const releases = [last];

  if (last.isPrerelease && lastRelease) {
    releases.unshift(lastRelease);
  }

  return Object.assign({}, repo, {releases});
};

const keyboards = {
  actionsList: () => Markup.inlineKeyboard([
    Markup.callbackButton('Add repository', 'addRepo'),
    Markup.callbackButton('Subscriptions', 'editRepos'),
    Markup.callbackButton('Get releases', 'getReleases')
  ]).extra(),
  backToActions: () => Markup.inlineKeyboard([
    Markup.callbackButton('Back', `actionsList`)
  ]).extra(),
  addOneMoreRepo: () => Markup.inlineKeyboard([
    Markup.callbackButton('Yes', `addRepo`),
    Markup.callbackButton('Nope', `actionsList`)
  ]).extra(),
  expandButton: (data) => Markup.inlineKeyboard([
    Markup.callbackButton('Expand', `getReleases:expand:${data}`)
  ]).extra(),
  allOrOneRepo: () => Markup.inlineKeyboard([
    [
      Markup.callbackButton('All subscriptions', `getReleases:all`),
      Markup.callbackButton('One repository', `getReleases:one`)
    ],
    [
      Markup.callbackButton('Back', `actionsList`)
    ]
  ]).extra(),
  table: (backActionName, actionName, items) => Markup.inlineKeyboard([
    ...items.map((item, index) => [Markup.callbackButton(item, `${actionName}:${index}`)]),
    [
      Markup.callbackButton('Back', backActionName)
    ]
  ]).extra(),
  //ToDo: pagination
  paginationTable: (backActionName, actionName, items) => Markup.inlineKeyboard([
    ...items.map((item, index) => [Markup.callbackButton(item, `${actionName}:${index}`)]),
    [
      Markup.callbackButton('prev', ''),
      Markup.callbackButton('next', '')
    ],
    [
      Markup.callbackButton('Back', backActionName)
    ]
  ]).extra(),
};


class Bot {
  constructor(db) {
    this.bot = new Telegraf(API_TOKEN);
    this.db = db;

    this.bot.use(memorySession({
      getSessionKey: (ctx) => `${ctx.chat && ctx.chat.id}`
    }));

    this.bot.telegram.getMe().then((botInfo) => {
      this.bot.options.username = botInfo.username;
    });

    this.listen();
  }

  listen() {
    this.bot.command('start', this.start.bind(this));
    this.bot.command('actions', this.actions.bind(this));
    this.bot.command('about', this.about.bind(this));

    this.bot.action('actionsList', this.actionsList.bind(this));
    this.bot.action('addRepo', this.addRepo.bind(this));

    this.bot.action('getReleases', this.getReleases.bind(this));
    this.bot.action(/^getReleases:expand:(.+)$/, this.getReleasesExpandeRelease.bind(this));
    this.bot.action('getReleases:all', this.getReleasesAll.bind(this));
    this.bot.action('getReleases:one', this.getReleasesOne.bind(this));
    this.bot.action(/^getReleases:one:(\d+)$/, this.getReleasesOneRepo.bind(this));
    this.bot.action(/^getReleases:one:(\d+?):release:(\d+?)$/, this.getReleasesOneRepoRelease.bind(this));

    this.bot.action('editRepos', this.editRepos.bind(this));
    this.bot.action(/^editRepos:delete:(.+)$/, this.editReposDelete.bind(this));

    this.bot.hears(/.+/, this.handleAnswer.bind(this));

    this.bot.startPolling();
  }

  async notifyUsers(repos) {
    await this.sendReleases(
      null,
      repos,
      (markdown, key, {watchedUsers}) =>
        watchedUsers.reduce((promise, userId) =>
            promise.then(() => this.bot.telegram.sendMessage(userId, markdown, Extra.markdown())),
          Promise.resolve())
    );
  };

  async start(ctx) {
    await ctx.reply(greeting);

    return await this.actions(ctx);
  }

  async actions(ctx) {
    ctx.session.action = null;

    const user = getUser(ctx);

    await this.db.createUser(user);

    return ctx.reply('Select an action', keyboards.actionsList());
  }

  about(ctx) {
    return ctx.replyWithMarkdown(about);
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
        default:
          ctx.session.action = null;
          return next();
      }
    }
  }

  addRepo(ctx) {
    ctx.session.action = 'addRepo';

    ctx.answerCallbackQuery('');

    return ctx.editMessageText('Please, send me the owner and name of repo (owner/name) or full url', keyboards.backToActions());
  }

  async editRepos(ctx) {
    const {subscriptions} = await this.db.getUser(getUser(ctx).id);

    ctx.answerCallbackQuery('');

    if (subscriptions && subscriptions.length) {
      const row = (repo) => [
        Markup.urlButton(`${repo.owner}/${repo.name}`, `https://github.com/${repo.owner}/${repo.name}`),
        Markup.callbackButton('🗑️', `editRepos:delete:${repo.owner}/${repo.name}`)
      ];

      return ctx.editMessageText(
        'Your subscriptions',
        Markup.inlineKeyboard([...subscriptions.map(row), [Markup.callbackButton('Back', `actionsList`)]]).extra()
      );
    } else {
      ctx.editMessageText(
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

    return ctx.editMessageText('What list do you want to see?', keyboards.allOrOneRepo());
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

    return ctx.editMessageText(
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

    try {
      const index = parseInt(ctx.match[1]);

      if (ctx.session.subscriptions && ctx.session.subscriptions[index]) {
        const {owner, name} = ctx.session.subscriptions[index];

        const repo = await this.db.getRepo(owner, name);

        return ctx.editMessageText(
          'Select release',
          keyboards.table(
            `getReleases:one`,
            `getReleases:one:${index}:release`,
            repo.releases.slice(PREVIEW_RELEASES_COUNT).map(({name, isPrerelease}) => `${name}${isPrerelease ? ' (pre-release)' : ''}`)
          )
        )
      }
    } catch (error) {
      return this.dataBrokenException(ctx);
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

  async getReleasesExpandeRelease(ctx) {
    const data = ctx.match[1];

    ctx.answerCallbackQuery('');

    try {
      const index = parseInt(data);
      const releases = ctx.session.releasesDescriptions;

      if (releases[index].length <= 1) {
        return ctx.editMessageText(releases[index][0], Extra.markdown())
      } else {
        return releases[index]
          .reduce((promise, message) => promise
            .then(() => ctx.replyWithMarkdown(message, Extra.markdown())),
            ctx.deleteMessage(ctx.update.callback_query.id));
      }
    } catch (error) {
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

    return ctx.editMessageText('Select an action', keyboards.actionsList());
  }

  getReleaseSender(ctx, repo, send) {
    return (promise, release) => {
      const {full, short} = getReleaseMessages(repo, release);

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
      return ctx.editMessageText('Data is broken');
    } catch (error) {
      return ctx.reply('Data is broken');
    }
  }
}

module.exports = {
  Bot
};
