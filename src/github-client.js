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
  name: tag && tag.name
});

const prepareReleases = (res) => res ? ((res.data && res.data.repository) || res).releases.nodes.filter(Boolean).map(prepareRelease) : [];

const prepareTag = (tag) => ({
  url: '',
  description: '',
  isPrerelease: false,
  name: tag.name
});

const prepareTags = (res) => res ? ((res.data && res.data.repository) || res).refs.nodes.filter(Boolean).map(prepareTag) : [];

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

const getMany = (query, repos, count) => {
  if (repos.length) {
    return client.query(`
      query {
        ${repos.map((repo, index) => `repo_${index}: ${query(repo.owner, repo.name, count)}`).join('\n')}
      }`)
      .then(({data}) =>
        data ? repos.map((repo, index) => Object.assign(
          {rawReleases: data['repo_' + index]},
          repo
        )) : []
      );
  } else {
    return Promise.resolve([]);
  }
};

const parseMany = (parser) => (data = []) => {
  return data.map(({owner, name, rawReleases}) => {
    return {
      owner,
      name,
      releases: parser(rawReleases)
    };
  })
};

const getManyReleases = (repos, count) => getMany(releases, repos, count)
  .then(parseMany(prepareReleases));

const getManyTags = (repos, count) => getMany(tags, repos, count)
  .then(parseMany(prepareTags));

const getManyVersions = async (repos, count) => {
  const releases = await getManyReleases(repos, count);
  const releasesUpdates = releases.filter(({releases}) => releases.length);
  const tags = await getManyTags(repos, count);
  const tagsUpdates = tags.filter(({releases}) => releases.length);

  return {releases: releasesUpdates, tags: tagsUpdates};
};

module.exports = {
  getVersions,
  getManyVersions
};
