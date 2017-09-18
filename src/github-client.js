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

const prepareReleases = (res) => res ? ((res.data && res.data.repository) || res).releases.nodes.map(prepareRelease) : [];

const prepareTag = (tag) => ({
  url: '',
  description: '',
  isPrerelease: false,
  name: tag.name
});

const prepareTags = (res) => res ? ((res.data && res.data.repository) || res).refs.nodes.map(prepareTag) : [];

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

const parseMany = (parser) => (res) => Object.keys(res.data).map((key) => {
  const delimiter = key.indexOf('_');
  const owner = key.substr(0, delimiter);
  const name = key.substr(delimiter + 1);

  return {
    owner,
    name,
    releases: parser(res.data[key])
  };
});

const getManyReleases = (repos, count) => getMany(releases)(repos, count)
  .then(parseMany(prepareReleases));

const getManyTags = (repos, count) => getMany(tags)(repos, count)
  .then(parseMany(prepareTags));

const getManyVersions = async (repos, count) => {
  const releases = await getManyReleases(repos, count);

  const reposWithoutReleases = releases.filter(({releases}) => !releases.length);
  const updates = releases.filter(({releases}) => releases.length);

  if (reposWithoutReleases.length) {
    const tags = await getManyTags(reposWithoutReleases, count);

    updates.push(...tags);
  }

  return updates;
};

module.exports = {
  getVersions,
  getManyVersions
};
