const fs = require('fs');


class Logger {
  constructor(path) {
    this.stream = fs.createWriteStream(path, {
      flags: 'a',
      encoding: 'utf8',
      mode: 0o666,
      autoClose: true
    });
  }

  end() {
    this.stream.end('done');
  }

  error(...args) {
    console.log(...args);
    this.output(args, 'error');
  }

  log(...args) {
    console.log(...args);
    this.output(args, 'info');
  }

  output(items, type) {
    this.stream.write(`${(new Date).toISOString()} | ${type} | ${items.map((item) => item.toString()).join(' ')}\n`);
  }
}

module.exports = {
  Logger
};
