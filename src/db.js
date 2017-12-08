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
        type: user.type
      }, user.type === "private" ? {
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
      } : {
        title: user.title
      }));

      console.log(`user ${user.first_name} ${user.last_name} created`);
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
        releases: []
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

  async getRepo(owner, name) {
    return await this.repos.findOne({owner, name});
  }

  async getAllRepos() {
    return await this.repos.find().toArray();
  }

  async updateRepo(owner, name, newReleases) {
    const {releases} = await this.repos.findOne({owner, name});
    const filteredReleases = this.findNewReleases(releases, newReleases);

    return await this.repos.updateOne({owner, name}, {
      $push: {
        releases: {$each: filteredReleases}
      }
    }, {upsert: true});
  }

  async updateRepos(data) {
    const repos = await this.getAllRepos();

    const newUpdates = data
      .map(this.getReleasesModifier(repos, this.findNewReleases))
      .filter((update) => update.releases.length);

    const preparedNewReleases = newUpdates.map((update) => ({
      filter: {
        owner: update.owner,
        name: update.name
      },
      update: {
        $push: {
          releases: {$each: update.releases}
        }
      }
    }));

    const changeUpdates = data
      .map(this.getReleasesModifier(repos, this.findChangedReleases))
      .filter((update) => update.releases.length);

    const preparedChangedReleases = changeUpdates
      .reduce((acc, {owner, name, releases}) => acc.concat(
        releases.map((release) => ({
            owner,
            name,
            release
          })
        )
      ), [])
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

    return [...newUpdates, ...changeUpdates];
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

  getReleasesModifier(repos, releasesFilter) {
    const findSimilar = (arr, repo) => arr.find(({owner, name}) => owner === repo.owner && name === repo.name);

    return (updatedRepo) => {
      const similarRepo = findSimilar(repos, updatedRepo);

      return {
        owner: updatedRepo.owner,
        name: updatedRepo.name,
        releases: releasesFilter(similarRepo.releases, updatedRepo.releases),
        watchedUsers: similarRepo.watchedUsers
      }
    }
  }

  findNewReleases(oldReleases, newReleases) {
    return newReleases.filter((newRelease) => (
      !oldReleases.some((oldRelease) => oldRelease.name === newRelease.name)
    ));
  }

  findChangedReleases(oldReleases, newReleases) {
    return newReleases.filter((newRelease) => (
      oldReleases.some((oldRelease) => (
        oldRelease.name === newRelease.name && (
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
