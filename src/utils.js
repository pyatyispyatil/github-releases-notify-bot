const MAX_MESSAGE_LENGTH = 4096;

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
${
    release.description
      .replace(/\*/mgi, '')
      .replace(/_/mgi, '\\_')
      .trim()
    }`;

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

const getReleaseMessages = (repo, release) => ({
  short: getShortReleaseMessage(repo, release),
  full: splitLongMessage(getFullReleaseMessage(repo, release), MAX_MESSAGE_LENGTH)
});

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
  const releases = last ? [last] : [];

  if (last && last.isPrerelease && lastRelease) {
    releases.unshift(lastRelease);
  }

  return Object.assign({}, repo, {releases});
};

module.exports = {
  getUser,
  getReleaseMessages,
  parseRepo,
  getLastReleasesInRepos,
};
