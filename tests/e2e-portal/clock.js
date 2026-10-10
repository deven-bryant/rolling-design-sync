'use strict';
// Preloaded into the screenshots API (`node -r ./clock.js`): shifts the process
// clock by the milliseconds in RDS_SCREENSHOTS_CLOCK_FILE, so the seed can
// backdate a week of history (Files trends compare this week with the last).
const fs = require('node:fs');

const file = process.env.RDS_SCREENSHOTS_CLOCK_FILE;
if (file) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const offset = () => {
    try {
      return Number(fs.readFileSync(file, 'utf8')) || 0;
    } catch {
      return 0;
    }
  };
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(realNow() + offset());
    }
    static now() {
      return realNow() + offset();
    }
  }
  globalThis.Date = ShiftedDate;
}
