const config = require('../config.json');
require('isomorphic-fetch');

const makeQuery = (query) => `
query {
  ${query}
}`;

const getClient = (params) => {
  if (!params.url) throw new Error('Missing url parameter');

  const headers = new Headers(params.headers);
  headers.append('Content-Type', 'application/json');

  return {
    query: async (query, variables) => {
      const req = new Request(params.url, {
        method: 'POST',
        body: JSON.stringify({
          query: makeQuery(query),
          variables: variables
        }),
        headers: headers,
        credentials: params.credentials
      });

      const response = await fetch(req);
      const body = response.json();

      if (body.errors && body.errors.length) {
        throw new Error(`Error while graphql request: ${JSON.stringify(body.errors, null, '  ')}`);
      } else {
        return body;
      }
    }
  }
};

function createClient(token) {
  return getClient({
    url: config.github.url,
    headers: {
      Authorization: 'Bearer ' + token
    }
  })
}

const publicClient = createClient(config.github.token);

const prepareRelease = ({url, isPrerelease, description, tag}) => ({
  url,
  description,
  isPrerelease,
  name: tag && tag.name
});

const prepareReleases = (res) => res ? ((res.data && res.data.repository) || res).releases.nodes.filter(Boolean).map(prepareRelease) : [];

const canAccessRepo = async (owner, name, client = publicClient) => {
  try {
    await getReleases(owner, name, client);
    return true;
  } catch (error) {
    return false;
  }
}

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

const getReleases = (owner, name, count = 1, client = publicClient) => client.query(
  releases(owner, name, count)
)
  .then(prepareReleases);

const getTags = (owner, name, count = 1, client = publicClient) => client.query(
  tags(owner, name, count)
)
  .then(prepareTags);

const getVersions = async (owner, name, count, client = publicClient) => {
  const [releases, tags] = await Promise.all([getReleases(owner, name, count, client), getTags(owner, name, count, client)]);

  return {releases, tags}
};

const getMany = (query, repos, count, client = publicClient) => {
  if (repos.length) {
    return client.query(
      repos.map((repo, index) => `repo_${index}: ${query(repo.owner, repo.name, count)}`).join('\n')
    )
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

const parseMany = (parser, toField) => (data = []) => {
  return data.map(({owner, name, rawReleases}) => {
    return {
      owner,
      name,
      [toField]: parser(rawReleases)
    };
  })
};

const getManyReleases = (repos, count, client = publicClient) => getMany(releases, repos, count, client)
  .then(parseMany(prepareReleases, 'releases'));

const getManyTags = (repos, count, client = publicClient) => getMany(tags, repos, count, client)
  .then(parseMany(prepareTags, 'tags'));

const getManyVersions = async (repos, count, client = publicClient) => {
  const releases = await getManyReleases(repos, count, client);
  const releasesUpdates = releases.filter(({releases}) => releases.length);
  const tags = await getManyTags(repos, count, client);
  const tagsUpdates = tags.filter(({tags}) => tags.length);

  return {releases: releasesUpdates, tags: tagsUpdates};
};

const BUNCH_SIZE = 50;
const getManyVersionsInBunches = async (repos, count, client = publicClient) => {
  const bunchesCount = Math.ceil(repos.length / BUNCH_SIZE);

  const resultedBunches = await Promise.all(Array(bunchesCount)
    .fill(null)
    .map((s, index) => getManyVersions(repos.slice(index * BUNCH_SIZE, index * BUNCH_SIZE + BUNCH_SIZE), count, client))
  );

  return resultedBunches.reduce((acc, {tags, releases}) => ({
    releases: acc.releases.concat(releases),
    tags: acc.tags.concat(tags)
  }), {releases: [], tags: []});
};

module.exports = {
  canAccessRepo,
  createClient,
  getVersions,
  getManyVersions,
  getManyVersionsInBunches
};
