const graphql = require('graphql-client');
const config = require('./config.json');

const client = graphql({
  url: config.github.url,
  headers: {
    Authorization: 'Bearer ' + config.github.token
  }
});

const getReleases = (owner, repo, count) => client.query(`
    query {
      repository(owner:"${owner}", name:"${repo}") {
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
  `);


module.exports = {
  getReleases,
};
