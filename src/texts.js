const about = (interval) => `
Bot to notify you about new releases in the repositories that you add to the subscription. New releases are checked every ${interval} minutes.

*GitHub repository* - [pyatyispyatil/github-releases-notify-bot](https://github.com/pyatyispyatil/github-releases-notify-bot)

Your wishes for features, as well as comments about bugs can be written [here](https://github.com/pyatyispyatil/github-releases-notify-bot/issues).
`;

const greeting = () => `
Hello!

That bot can notify you about new releases.
To receive a notification, you must subscribe to repos that you would like to observe. 
To do this, click the "Add repository" button.

In addition, you can see the latest releases of your observed repositories. 
To do this, click the "Get Releases" button.
`;

const stats = ({
                 groupsCount,
                 usersCount,
                 reposCount,
                 averageSubscriptionsPerUser,
                 averageWatchPerRepo,
                 usersInGroups,
                 chatsInfo
               }) => `
Stats

Groups count: ${groupsCount}
Users count: ${usersCount}
Users in groups count: ${usersInGroups}
Repos count: ${reposCount}
Average subscriptions per user: ${averageSubscriptionsPerUser}
Average watch per repo: ${averageWatchPerRepo}

Chats: 
${
  chatsInfo.map(({title, members}) => `${title} - ${members}\n`)
}
`;

module.exports = {
  about, greeting, stats
};
