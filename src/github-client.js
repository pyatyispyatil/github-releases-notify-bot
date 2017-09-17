const graphql = require('graphql-client');
const config = require('./config.json');

const client = graphql({
  url: config.github.url,
  headers: {
    Authorization: 'Bearer ' + config.github.token
  }
});

const prepareRelease = ({url, isPrerelease, description, tag}) => ({
  url,
  description,
  isPrerelease,
  name: tag.name
});

const prepareReleases = (res) => res.data.repository.releases.nodes.map(prepareRelease);

const prepareTag = (tag) => ({
  url: '',
  description: '',
  isPrerelease: false,
  name: tag.name
});

const prepareTags = (res) => res.data.repository.refs.nodes.map(prepareTag);

const releases = (owner, name, count) => `
repository(owner:"${owner}", name:"${name}") {
  releases(last: ${count}) {
    nodes {
      url,
      isPrerelease,
      description,
      tag {
        name
      }
    }
  }
}`;

const tags = (owner, name, count) => `
repository(owner:"${owner}", name:"${name}") {
  refs(last: ${count}, refPrefix: "refs/tags/") {
    nodes {
      name
    }
  }
}`;

const getReleases = (owner, name, count = 1) => client.query(`
    query {
      ${releases(owner, name, count)}
    }
  `)
  .then(prepareReleases);

const getTags = (owner, name, count = 1) => client.query(`
    query {
      ${tags(owner, name, count)}
    }`)
  .then(prepareTags);

const getVersions = (owner, name, count) => getReleases(owner, name, count)
  .then((releases) => releases.length ? releases : getTags(owner, name, count));

const getMany = (query) => (repos, count) => client.query(`
    query {
      ${repos.map((repo) => `
        ${repo.owner + '_' + repo.name}: ${query(repo.owner, repo.name, count)}
      `).join('\n')}
    }
`);

const parseMany = (parser) => (fullRes) => Object.entries(fullRes.data).reduce((acc, [key, res]) => {
  const delimiter = key.indexOf('_');
  const owner = key.substr(0, delimiter);
  const name = key.substr(delimiter + 1);

  if (!acc[owner]) {
    acc[owner] = {};
  }

  acc[owner][name] = parser(res);

  return acc;
}, {});

const getManyReleases = (repos, count) => getMany(releases)(repos, count)
  .then(parseMany(prepareReleases));

const getManyTags = (repos, count) => getMany(tags)(repos, count)
  .then(parseMany(prepareTags));

const getManyVersions = async (repos, count) => {
  const releases = await getManyReleases(repos, count);

  const reposWithoutReleases = Object.keys(releases)
    .map((owner) => Object.keys(releases[owner])
      .reduce((acc, name) => acc.concat({
        owner,
        name,
        releases: releases[owner][name]
      }), []))
    .reduce((acc, arr) => acc.concat(arr))
    .filter((repo) => !repo.releases.length);

  if (reposWithoutReleases.length) {
    const tags = await getManyTags(reposWithoutReleases, count);

    Object.keys(tags)
      .forEach((owner) => Object.keys(tags[owner])
        .forEach((name) => releases[owner][name] = tags[owner][name]));
  }

  return releases;
};

module.exports = {
  getVersions,
  getManyVersions
};
