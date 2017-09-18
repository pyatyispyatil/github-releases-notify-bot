const Telegraf = require('telegraf');
const config = require('./config.json');
const {Extra, Markup, memorySession} = require('telegraf');

const {getVersions} = require('./github-client');

const API_TOKEN = config.telegram.token || '';

const about = `
Bot for notification of new releases in repositories about which you tell him.

*Author* - Nikolay Ryabov (pyatyispyatil@gmail.com)
*GitHub Repository* - [gloooom/github-releases-notify-bot](https://github.com/gloooom/github-releases-notify-bot)

Your wishes for features, as well as comments about bugs can be written [here](https://github.com/gloooom/github-releases-notify-bot/issues).
`;


const getUser = (ctx) => ctx.message ? ctx.message.from : ctx.update.callback_query.from;

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
  full: getFullReleaseMessage(repo, release)
})

const parseRepo = (str) => {
  let owner, name;

  if (str) {
    const isUrl = /https?:\/\//.test(str);

    if (isUrl) {
      [, owner, name] = str.match(/https?:\/\/github\.com\/(.*?)\/(.*?)\/?$/i);
    } else {
      [owner, name] = str.replace(' ', '').split('/');
    }
  }

  if (owner && name) {
    return {owner, name};
  } else {
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
    Markup.callbackButton('Edit subscriptions', 'editRepos'),
    Markup.callbackButton('Get latest releases', 'getReleases')
  ]).extra(),
  backToActions: () => Markup.inlineKeyboard([
    Markup.callbackButton('Back', `actionsList`)
  ]).extra(),
  addOneMoreRepo: () => Markup.inlineKeyboard([
    Markup.callbackButton('Add one more?', `addRepo`)
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
  ]).extra()
};


class Bot {
  constructor(db) {
    const bot = new Telegraf(API_TOKEN);

    this.bot = bot;
    this.db = db;

    this.bot.use(memorySession());

    this.bot.telegram.getMe().then((botInfo) => {
      this.bot.options.username = botInfo.username;
    });

    this.listen();

    bot.startPolling();
  }

  listen() {
    this.bot.command('start', this.start.bind(this));
    this.bot.command('actions', this.actions.bind(this));
    this.bot.command('about', this.about.bind(this));

    this.bot.action('actionsList', this.actionsList.bind(this));
    this.bot.action('addRepo', this.addRepo.bind(this));

    this.bot.action('getReleases', this.getReleases.bind(this));
    this.bot.action(/getReleases:expand:(.+)/, this.getReleasesExpanded.bind(this));
    this.bot.action('getReleases:all', this.getReleasesAll.bind(this));
    this.bot.action('getReleases:one', this.getReleasesOne.bind(this));
    this.bot.action(/getReleases:one:(.+)/, this.getReleasesOneSelected.bind(this));

    this.bot.action('editRepos', this.editRepos.bind(this));
    this.bot.action(/editRepos:delete:(.+)/, this.editReposDelete.bind(this));

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
    const user = getUser(ctx);

    await this.db.createUser(user);

    return this.actions(ctx);
  }

  actions(ctx) {
    ctx.session.action = null;

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
                const releases = await getVersions(repo.owner, repo.name, 20);

                await this.db.addRepo(repo.owner, repo.name);
                await this.db.updateRepo(repo.owner, repo.name, releases);
              } catch (error) {
                return ctx.reply('Cannot subscribe to this repo. Please enter another:');
              }
            }

            await this.db.bindUserToRepo(user.id, repo.owner, repo.name);

            ctx.session.action = null;

            return ctx.reply('Done!', keyboards.addOneMoreRepo());
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

    return ctx.editMessageText('Please, enter the owner and name of repo (owner/name) or full url', keyboards.backToActions());
  }

  async editRepos(ctx) {
    const {subscriptions} = await this.db.getUser(getUser(ctx).id);

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
    return ctx.editMessageText('Select variant', keyboards.allOrOneRepo());
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

    return ctx.editMessageText(
      'Select repository',
      keyboards.table(
        'getReleases',
        'getReleases:one',
        subscriptions.map(({owner, name}) => `${owner}/${name}`)
      )
    )
  }

  async getReleasesOneSelected(ctx) {
    try {
      const index = parseInt(ctx.match[1]);

      if (ctx.session.subscriptions && ctx.session.subscriptions[index]) {
        const {owner, name} = ctx.session.subscriptions[index];

        const repo = await this.db.getRepo(owner, name);

        ctx.answerCallbackQuery('');

        return this.sendReleases(
          ctx,
          [Object.assign(repo, {releases: repo.releases.slice(-5)})],
          ctx.replyWithHTML
        );
      }
    } catch (error) {
      return ctx.editMessageText('Broken data');
    }
  }

  async getReleasesExpanded(ctx) {
    const data = ctx.match[1];

    try {
      const index = parseInt(data);

      return ctx.editMessageText(ctx.session.releasesDescriptions[index], Extra.markdown());
    } catch (error) {
      return ctx.editMessageText('Data is broken');
    }
  }

  async sendReleases(ctx, repos, send) {
    if (ctx) {
      ctx.session.releasesDescriptions = [];
    }

    return repos.reduce((promise, repo) => {
      const sendRelease = (lastPromise, release) => {
        const {full, short} = getReleaseMessages(repo, release);

        if (ctx) {
          ctx.session.releasesDescriptions.push(full);

          const key = keyboards.expandButton(ctx.session.releasesDescriptions.length - 1);

          return lastPromise.then(() => send(short, key, repo));
        } else {
          return lastPromise.then(() => send(full, '', repo));
        }
      };

      return repo.releases.reduce((lastPromise, release) =>
          lastPromise.then(() => sendRelease(lastPromise, release)),
        promise);
    }, Promise.resolve());
  }

  actionsList(ctx) {
    return ctx.editMessageText('Select an action', keyboards.actionsList());
  }
}

module.exports = {
  Bot
};
