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
      await this.users.insertOne({
        userId: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        is_bot: user.is_bot,
        username: user.username,
        lang: user.language_code,
        subscriptions: []
      });
    } else {
      console.log('User is already created');
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
    return await this.repos.find({}).toArray();
  }

  async updateRepo(owner, name, newReleases) {
    const {releases} = await this.repos.findOne({owner, name});
    const filteredReleases = this.compareReleases(releases, newReleases);

    return await this.repos.updateOne({owner, name}, {
      $push: {
        releases: {$each: filteredReleases}
      }
    }, {upsert: true});
  }

  async updateRepos(data) {
    const repos = await this.getAllRepos();

    const findSimilar = (arr, repo) => arr.find(({owner, name}) => owner === repo.owner && name === repo.name);

    const updates = data
      .map((update) => {
        const similarRepo = findSimilar(repos, update);

        return {
          owner: update.owner,
          name: update.name,
          releases: this.compareReleases(similarRepo.releases, update.releases),
          watchedUsers: similarRepo.watchedUsers
        }
      })
      .filter((update) => update.releases.length);

    const preparedUpdates = updates.map((update) => ({
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

    await Promise.all([...preparedUpdates.map(({filter, update}) => this.repos.updateOne(filter, update))]);

    return updates;
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

  compareReleases(oldReleases, newReleases) {
    return newReleases.filter((newRelease) => (
      !oldReleases.some((oldRelease) => oldRelease.name === newRelease.name)
    ));
  }
}

module.exports = {
  DB
};
