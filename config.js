// config.js
module.exports = {
  BOT_TOKEN: "7579550318:AAGmZYCs6Idp4x2QdRM9I7C6u84UmShTpQk", // e.g. 123456:ABC-xxxxxx
  CHANNEL_ID: -1002301426709,    // e.g. -100123456789
  ADMIN_ID: 7381981708,          // your Telegram user ID

  // Filenames for data
  STATS_FILE: "stats.json",      // daily stats
  EVENTS_FILE: "events.json",    // start/stop logs
  BINS_FILE: "bins.json",        // BIN database

  // Default settings
  DEFAULT_INTERVAL: 10,          // seconds between cards
  ERROR_SLEEP: 600,              // wait 600s if sending fails
  POLL_TIMEOUT: 30               // getUpdates timeout (seconds)
};