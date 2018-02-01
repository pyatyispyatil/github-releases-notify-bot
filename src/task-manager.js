class TaskManager {
  constructor() {
    this.tasks = {};
  }

  subscribe(name, cb) {
    if (this.tasks[name]) {
      this.tasks[name].subscriptions.push(cb);
    }
  }

  add(name, cb, interval) {
    const descriptor = setInterval(() => this.execute(name), interval * 1000);

    this.tasks[name] = {
      descriptor,
      cb,
      subscriptions: []
    };
  }

  stop(name) {
    clearInterval(this.tasks[name].descriptor);
    delete this.tasks[name];
  }

  execute(name) {
    Promise.resolve(this.tasks[name].cb())
      .then((data) => this.tasks[name].subscriptions.forEach((sub) => sub(data)))
  }
}

module.exports = {
  TaskManager
};
