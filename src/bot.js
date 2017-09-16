const Telegraf = require('telegraf');
const config = require('./config.json');
const { Router, Extra, memorySession, Markup } = require('telegraf');


const API_TOKEN = config.telegram.token || '';
const PORT = config.server.port || 8443;
const URL = config.server.url || '';

const getUser = (ctx) => ctx.message.from.id;

class Bot {
  constructor() {

    const bot = new Telegraf(API_TOKEN);

    this.bot = bot;

    this.bot.telegram.getMe().then((botInfo) => {
      this.bot.options.username = botInfo.username;
    });

    // bot.telegram.setWebhook(URL);
    // bot.startWebhook('/', null, PORT);

    //this.listen();


    bot.command('addRepo', (ctx) => {
      return ctx.reply('Please, enter the owner and name of repo (<owner>/<name>) or full url', Extra.HTML().markup((m) =>
        m.inlineKeyboard([
          m.callbackButton('Add repo', 'addRepo'),
          m.callbackButton('Edit repos list', 'editRepos')
        ])))
    });

    bot.action(/.+/, (ctx) => {
      console.log(Object.keys(ctx));

      return ctx.editMessageText('hhelo', Extra.HTML().markup((m) =>
        m.inlineKeyboard([
          m.callbackButton('123', 'Coke'),
          m.callbackButton('321', 'Pepsi')
        ])));
    });

    bot.startPolling();
  }

  listen() {
    this.bot.command('/addRepo', this.addRepo);
    this.bot.command('/removeRepo', this.removeRepo);
    this.bot.command('/getReleases', this.getReleases);

    this.bot.startPolling();
  }

  addRepo(ctx, next) {

    return next();
  };

  removeRepo(ctx, next) {
    ctx.reply('test');

    return next();
  };

  getReleases(ctx, next) {
    ctx.reply('');

    return next();
  };
}

module.exports = {
  Bot
};
