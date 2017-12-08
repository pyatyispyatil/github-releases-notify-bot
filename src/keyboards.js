const {Markup} = require('telegraf');

module.exports = {
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
