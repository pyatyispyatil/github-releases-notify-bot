const fs = require('fs');


class Logger {
  constructor(path) {
    this.path = path;
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
    const str = `${(new Date).toISOString()} | ${type} | ${items.map((item) => item.toString()).join(' ')}\n`;

    fs.writeFileSync(this.path, str, {flag: 'a+'});
  }
}

module.exports = {
  Logger
};
