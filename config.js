// config.js
module.exports = {
  BOT_TOKEN: "", // e.g. 123456:ABC-xxxxxx
  CHANNEL_ID: "",    // e.g. -100123456789
  ADMIN_ID: "",          // your Telegram user ID

  // Filenames for data
  STATS_FILE: "stats.json",      // daily stats
  EVENTS_FILE: "events.json",    // start/stop logs
  BINS_FILE: "bins.json",        // BIN database

  // Default settings
  DEFAULT_INTERVAL: 10,          // seconds between cards
  ERROR_SLEEP: 600,              // wait 600s if sending fails
  POLL_TIMEOUT: 30               // getUpdates timeout (seconds)
};
