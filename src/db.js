const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');

class DB {
  constructor(url, name) {
    this.name = name;
    this.url = url;

    this.users = null;
    this.repos = null;
  }

  async init() {
    try {
      const db = await new Promise((resolve) => MongoClient.connect(this.url + this.name, (err, db) => {
        assert.equal(null, err);

        console.log("Connected successfully to DB");

        resolve(db);
      }));

      await this.createCollections(db);

      console.log('Collections created');

      this.users = db.collection('users');
      this.repos = db.collection('repos');

      await this.createIndexes();

      console.log('Indexes created');
    } catch (error) {
      console.log('Something wrong with MongoDB =(');
    }
  }

  async createCollections(db) {
    const neededCollections = ['users', 'repos'];

    const collections = await db.collections();

    const collectionsForCreate = neededCollections.filter((neededCollection) => collections.indexOf(neededCollection) === -1);

    return await Promise.all([...collectionsForCreate.map((collection) => db.createCollection(collection))]);
  }

  async createIndexes() {
    const isExistUsersIndex = this.users.indexExists('userId');

    if (!isExistUsersIndex) {
      return await this.users.createIndex({userId: 1}, {unique: true});
    } else {
      return null;
    }
  }

  async createUser(user) {
    const createdUser = await this.getUser(user.id);

    if (!createdUser) {
      await this.users.insertOne(Object.assign({
        userId: user.id,
        subscriptions: [],
        type: user.type,
        username: user.username,
        date: (new Date()).toISOString(),
      }, user.type === "private" ? {
        isBot: user.is_bot,
        firstName: user.first_name,
        lastName: user.last_name
      } : {
        title: user.title
      }));

      const userTitle = user.type === 'private' ? `${user.first_name} ${user.last_name}` : user.title;

      console.log(`user ${userTitle} created`);
    }
  }

  async addRepo(owner, name) {
    const repo = await this.repos.findOne({owner, name});

    if (repo && repo.owner && repo.name) {
      return 'exist';
    } else {
      await this.repos.insertOne({
        owner,
        name,
        watchedUsers: [],
        releases: [],
        tags: []
      });

      return 'new';
    }
  }

  async removeRepo(owner, name) {
    return await this.repos.deleteOne({
      owner,
      name
    });
  }

  async getUserSubscriptions(userId) {
    return await this.repos.find({watchedUsers: userId}).toArray();
  }

  async getUser(userId) {
    return await this.users.findOne({userId});
  }

  async getAllUsers() {
    return await this.users.find().toArray();
  }

  async getRepo(owner, name) {
    return await this.repos.findOne({owner, name});
  }

  async getAllRepos() {
    return await this.repos.find().toArray();
  }

  async getAllReposNames() {
    return await this.repos.find({}, {name: 1, owner: 1, watchedUsers: 1, _id: 0}).toArray();
  }

  async updateRepo(owner, name, {releases: newReleases, tags: newTags}) {
    const {releases, tags} = await this.repos.findOne({owner, name});

    const filteredReleases = this.findNewReleases(releases, newReleases);
    const filteredTags = this.findNewReleases(tags, newTags);

    return await this.repos.updateOne({owner, name}, {
      $push: {
        releases: {$each: filteredReleases},
        tags: {$each: filteredTags}
      }
    }, {upsert: true});
  }

  async updateRepos({releases, tags}) {
    const repos = await this.getAllRepos();

    const newReleasesUpdates = this.modifyReleases(releases, repos, 'releases', this.findNewReleases);
    const newTagsUpdates = this.modifyReleases(tags, repos, 'tags', this.findNewReleases);

    const preparedNewReleases = [
      ...newReleasesUpdates
        .filter(Boolean)
        .map((update) => ({
          filter: {
            owner: update.owner,
            name: update.name
          },
          update: {
            $push: {
              releases: {$each: update.releases}
            }
          }
        })),
      ...newTagsUpdates
        .filter(Boolean)
        .map((update) => ({
          filter: {
            owner: update.owner,
            name: update.name
          },
          update: {
            $push: {
              tags: {$each: update.tags}
            }
          }
        }))
    ];

    const changedUpdates = this.modifyReleases(releases, repos, 'releases', this.findChangedReleases);

    const preparedChangedReleases = changedUpdates
      .filter(Boolean)
      .reduce((acc, {owner, name, releases}) => acc.concat(
        releases.map((release) => ({
            owner,
            name,
            release
          })
        )
      ), [])
      .filter(Boolean)
      .map((update) => ({
        filter: {
          owner: update.owner,
          name: update.name,
          'releases.name': update.release.name
        },
        update: {
          $set: {
            'releases.$': {
              name: update.release.name,
              description: update.release.description,
              isPrerelease: update.release.isPrerelease,
              url: update.release.url,
            }
          }
        }
      }));

    await Promise.all([
      ...[
        ...preparedNewReleases,
        ...preparedChangedReleases
      ].map(({filter, update}) => this.repos.updateOne(filter, update))
    ]);

    const onlyTagsUpdates = newTagsUpdates
      .filter(({owner, name}) => !newReleasesUpdates
        .some((release) => release.owner === owner && release.name === name));

    const newReleasesWithTags = newReleasesUpdates
      .map((repoWithRelease) => {
        const similarRepoWithTags = newTagsUpdates
          .find(({owner, name}) => repoWithRelease.owner === owner && repoWithRelease.name === name);

        if (similarRepoWithTags) {
          return Object.assign({}, repoWithRelease, {
            releases: [
              ...repoWithRelease.releases,
              ...similarRepoWithTags.tags
                .filter(({name}) => !repoWithRelease.releases
                  .some((release) => release.name === name))
            ]
          });
        } else {
          return repoWithRelease;
        }
      });

    return [...newReleasesWithTags, ...onlyTagsUpdates, ...changedUpdates]
      .map((entry) => entry.tags ? Object.assign({releases: entry.tags}, entry) : entry);
  }

  async bindUserToRepo(userId, owner, name) {
    const status = await this.addRepo(owner, name);

    await Promise.all([
      this.repos.updateOne({owner, name}, {
        $addToSet: {
          watchedUsers: userId
        }
      }, {upsert: true}),
      this.users.updateOne({userId}, {
        $addToSet: {
          subscriptions: {owner, name}
        }
      }, {upsert: true})
    ]);

    return status;
  }

  async unbindUserFromRepo(userId, owner, name) {
    return await Promise.all([
      this.repos.updateOne({owner, name}, {
        $pull: {
          watchedUsers: userId
        }
      }, {upsert: true}),
      this.users.updateOne({userId}, {
        $pull: {
          subscriptions: {owner, name}
        }
      }, {upsert: true})
    ]);
  }

  modifyReleases(entries, repos, type, releasesFilter) {
    const findSimilar = (arr, repo) => arr
      .filter(Boolean)
      .find(({owner, name}) => owner === repo.owner && name === repo.name);

    return entries
      .filter(Boolean)
      .map((updatedRepo = {}) => {
        const similarRepo = findSimilar(repos, updatedRepo);

        return {
          owner: updatedRepo.owner,
          name: updatedRepo.name,
          [type]: releasesFilter(similarRepo[type], updatedRepo[type]),
          watchedUsers: similarRepo.watchedUsers || []
        }
      })
      .filter((update) => update[type].length)
  }

  findNewReleases(oldReleases = [], newReleases = []) {
    return newReleases.filter((newRelease) => (
      newRelease && !oldReleases.some((oldRelease) =>
        oldRelease && (oldRelease.name === newRelease.name)
      )
    ));
  }

  findChangedReleases(oldReleases = [], newReleases = []) {
    return newReleases.filter((newRelease) => (
      newRelease && oldReleases.some((oldRelease) => (
        oldRelease && (
          oldRelease.name === newRelease.name
        ) && (
          oldRelease.description !== newRelease.description
          || oldRelease.isPrerelease !== newRelease.isPrerelease
        )
      ))
    ));
  }
}

module.exports = {
  DB
};
