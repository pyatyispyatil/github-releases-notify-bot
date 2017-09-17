const graphql = require('graphql-client');
const config = require('./config.json');

const client = graphql({
  url: config.github.url,
  headers: {
    Authorization: 'Bearer ' + config.github.token
  }
});

const getReleases = (owner, name, count = 1) => client.query(`
    query {
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
      }
    }
  `)
  .then((res) => res.data.repository.releases.nodes
    .map(({url, isPrerelease, description, tag}) => ({
      url,
      description,
      isPrerelease,
      name: tag.name
    })));

const getTags = (owner, name, count) => client.query(`
    query {
      repository(owner:"${owner}", name:"${name}") {
        refs(last: ${count}, refPrefix: "refs/tags/") {
          nodes {
            name
          }
        }
      }
    }`)
  .then((res) => res.data.repository.refs.nodes
    .map((tag) => ({
      url: '',
      description: '',
      isPrerelease: false,
      name: tag.name
    })));

const getVersions = (owner, name, count) => getReleases(owner, name, count)
  .then((releases) => releases.length ? releases : getTags(owner, name, count));

module.exports = {
  getVersions,
};
