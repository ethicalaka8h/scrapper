// app.js
const fs = require("fs");
const fetch = global.fetch || require("node-fetch");
const path = require("path");

const {
  BOT_TOKEN,
  CHANNEL_ID,
  ADMIN_ID,
  STATS_FILE,
  EVENTS_FILE,
  BINS_FILE,
  DEFAULT_INTERVAL,
  ERROR_SLEEP,
  POLL_TIMEOUT
} = require("./config");

const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Global bot state
let isRunning = false;        // Whether cards are currently being sent
let stopEndTime = null;       // If set, auto-stop at this time
let runStartTime = null;      // When current run started
let lastSendTime = 0;         // Track last card-sent time
let offset = 0;               // For polling getUpdates
let interval = DEFAULT_INTERVAL; // Delay between sending each card

// Helper: sleep for ms milliseconds
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------------
// JSON Helpers
// ------------------------------------------------------------------
function loadJSON(filepath) {
  if (!fs.existsSync(filepath)) {
    return {};
  }
  try {
    const data = fs.readFileSync(filepath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filepath}:`, err);
    return {};
  }
}

function saveJSON(filepath, data) {
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing ${filepath}:`, err);
  }
}

// ------------------------------------------------------------------
// Stats (daily sent/error) in stats.json
// ------------------------------------------------------------------
function incrementStats(key, amount = 1) {
  const stats = loadJSON(STATS_FILE);
  const today = new Date().toISOString().slice(0, 10);
  if (!stats[today]) {
    stats[today] = { sent: 0, error: 0 };
  }
  stats[today][key] += amount;
  saveJSON(STATS_FILE, stats);
}

// ------------------------------------------------------------------
// Event logs (start/stop/times) in events.json
// ------------------------------------------------------------------
function logEvent(eventType, extra = null) {
  const events = loadJSON(EVENTS_FILE);
  if (!events.events) {
    events.events = [];
  }
  const entry = {
    type: eventType,
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19)
  };
  if (extra) {
    Object.assign(entry, extra);
  }
  events.events.push(entry);
  saveJSON(EVENTS_FILE, events);
}

// ------------------------------------------------------------------
// Bins in bins.json
// ------------------------------------------------------------------
function loadBins() {
  const data = loadJSON(BINS_FILE);
  if (!data.bins) {
    data.bins = [];
  }
  return data.bins;
}

function saveBins(binList) {
  const data = { bins: binList };
  saveJSON(BINS_FILE, data);
}

// ------------------------------------------------------------------
// Telegram Bot API functions
// ------------------------------------------------------------------
async function getUpdates(offsetValue) {
  try {
    const url = `${BASE_URL}/getUpdates?offset=${offsetValue}&timeout=${POLL_TIMEOUT}`;
    const resp = await fetch(url, { timeout: (POLL_TIMEOUT + 5) * 1000 });
    return await resp.json();
  } catch (err) {
    console.error(`Error fetching updates: ${err}`);
    return null;
  }
}

async function sendMessage(chatId, text, replyMarkup = null) {
  try {
    const url = `${BASE_URL}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const resp = await fetch(url, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      timeout: 10000
    });
    if (resp.status === 200) {
      return true;
    } else {
      const respText = await resp.text();
      console.error(`Failed to send message. Status: ${resp.status}, Response: ${respText}`);
      return false;
    }
  } catch (err) {
    console.error(`Exception sending message: ${err}`);
    return false;
  }
}

async function getBinDetails(binNumber) {
  try {
    const url = `https://bins.antipublic.cc/bins/${binNumber}`;
    const resp = await fetch(url, { timeout: 10000 });
    if (resp.status === 200) {
      const data = await resp.json();
      return {
        brand: data.brand || "Unknown",
        type: data.type || "Unknown",
        level: data.level || "Unknown",
        bank: data.bank || "Unknown",
        country_name: data.country_name || "Unknown",
        country_flag: data.country_flag || "🏳️"
      };
    } else {
      console.error(`BIN API error: status ${resp.status}`);
      return {
        brand: "Unknown",
        type: "Unknown",
        level: "Unknown",
        bank: "Unknown",
        country_name: "Unknown",
        country_flag: "🏳️"
      };
    }
  } catch (err) {
    console.error(`Error fetching BIN details: ${err}`);
    return {
      brand: "Unknown",
      type: "Unknown",
      level: "Unknown",
      bank: "Unknown",
      country_name: "Unknown",
      country_flag: "🏳️"
    };
  }
}

// ------------------------------------------------------------------
// Card Generation
// ------------------------------------------------------------------
function generateCardData() {
  const binsList = loadBins();
  if (binsList.length === 0) return null;
  const chosenBin = binsList[Math.floor(Math.random() * binsList.length)].trim().slice(0, 6);
  const remainLen = 16 - chosenBin.length;
  let tail = "";
  for (let i = 0; i < remainLen; i++) {
    tail += Math.floor(Math.random() * 10).toString();
  }
  const cardNumber = chosenBin + tail;
  const month = String(Math.floor(Math.random() * 16) + 1).padStart(2, "0");
  const year = String(Math.floor(Math.random() * (32 - 24 + 1)) + 24).padStart(2, "0");
  const cvv = String(Math.floor(Math.random() * (999 - 100 + 1)) + 100).padStart(3, "0");
  return {
    bin: chosenBin,
    card_number: cardNumber,
    month: month,
    year: year,
    cvv: cvv
  };
}

function generateRandomBins(count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    let bin6;
    if (Math.random() < 0.5) {
      // Visa: 400000..499999
      bin6 = Math.floor(Math.random() * (499999 - 400000 + 1)) + 400000;
    } else {
      // MasterCard: 510000..559999
      bin6 = Math.floor(Math.random() * (559999 - 510000 + 1)) + 510000;
    }
    result.push(bin6.toString());
  }
  // Shuffle the array
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ------------------------------------------------------------------
// Main Bot
// ------------------------------------------------------------------
async function main() {
  console.log("Bot started. Polling for updates...");

  while (true) {
    // 1) Auto-stop if time is up
    if (stopEndTime && (Date.now() / 1000) >= stopEndTime) {
      isRunning = false;
      const ranSecs = Math.floor(Date.now() / 1000 - runStartTime);
      logEvent("auto-stop", { ran_for_seconds: ranSecs });
      await sendMessage(ADMIN_ID, "⏹️ Time is up! The bot is now off.");
      runStartTime = null;
      stopEndTime = null;
      console.log("Auto-stop triggered, bot is off.");
    }

    // 2) Poll for updates
    const updates = await getUpdates(offset);
    if (updates && updates.ok) {
      for (const upd of updates.result) {
        offset = upd.update_id + 1;
        if (upd.message) {
          const msg = upd.message;
          const userId = msg.from.id;
          const text = msg.text || "";

          if (text.startsWith("/")) {
            // Non-admin => "not authorized"
            const knownCmds = ["/start", "/stop", "/time", "/info", "/logs", "/bin", "/remove", "/r", "/stime", "/gen"];
            if (userId !== ADMIN_ID) {
              if (knownCmds.some(cmd => text.toLowerCase().startsWith(cmd))) {
                await sendMessage(userId, "You are not authorized to use this bot. Please contact admin @ethicalakash.");
              }
              continue;
            }

            // Admin commands
            const cmdParts = text.trim().split(/\s+/, 2);
            const command = cmdParts[0].toLowerCase();

            if (command === "/start") {
              isRunning = true;
              stopEndTime = null;
              runStartTime = Math.floor(Date.now() / 1000);
              logEvent("start", { mode: "indefinite" });
              await sendMessage(ADMIN_ID, "▶️ Bot started sending cards indefinitely.");
            }
            else if (command === "/stop") {
              if (cmdParts.length > 1) {
                const stopSecs = parseInt(cmdParts[1]);
                if (!isNaN(stopSecs)) {
                  isRunning = true;
                  stopEndTime = Math.floor(Date.now() / 1000) + stopSecs;
                  runStartTime = Math.floor(Date.now() / 1000);
                  logEvent("timed-stop", { stop_in_seconds: stopSecs });
                  await sendMessage(ADMIN_ID, `⏳ Bot will stop automatically in ${stopSecs} seconds.`);
                } else {
                  await sendMessage(ADMIN_ID, "Usage: /stop <seconds>");
                }
              } else {
                isRunning = false;
                if (runStartTime !== null) {
                  const ranFor = Math.floor(Date.now() / 1000 - runStartTime);
                  logEvent("stop", { ran_for_seconds: ranFor });
                } else {
                  logEvent("stop");
                }
                runStartTime = null;
                stopEndTime = null;
                await sendMessage(ADMIN_ID, "⏹️ Bot stopped immediately.");
              }
            }
            else if (command === "/stime") {
              if (cmdParts.length > 1) {
                const stimeSecs = parseInt(cmdParts[1]);
                if (!isNaN(stimeSecs)) {
                  isRunning = true;
                  runStartTime = Math.floor(Date.now() / 1000);
                  stopEndTime = runStartTime + stimeSecs;
                  logEvent("stime", { duration_seconds: stimeSecs });
                  await sendMessage(ADMIN_ID, `⏳ Bot started for ${stimeSecs} seconds. It will stop automatically.`);
                } else {
                  await sendMessage(ADMIN_ID, "Usage: /stime <seconds>");
                }
              } else {
                await sendMessage(ADMIN_ID, "Usage: /stime <seconds>");
              }
            }
            else if (command === "/time") {
              if (cmdParts.length > 1) {
                const newInterval = parseInt(cmdParts[1]);
                if (!isNaN(newInterval)) {
                  interval = newInterval;
                  lastSendTime = Date.now() / 1000;
                  await sendMessage(ADMIN_ID, `⏱ Interval set to ${newInterval} second(s) per card.`);
                  logEvent("interval-change", { new_interval: newInterval });
                } else {
                  await sendMessage(ADMIN_ID, "Usage: /time <seconds>");
                }
              } else {
                await sendMessage(ADMIN_ID, "Usage: /time <seconds>");
              }
            }
            else if (command === "/gen") {
              if (cmdParts.length > 1) {
                const genCount = parseInt(cmdParts[1]);
                if (!isNaN(genCount) && genCount > 0) {
                  const binsList = generateRandomBins(genCount);
                  await sendMessage(ADMIN_ID, binsList.join(","));
                } else {
                  await sendMessage(ADMIN_ID, "Please specify a positive number for /gen.");
                }
              } else {
                await sendMessage(ADMIN_ID, "Usage: /gen <count>");
              }
            }
            else if (command === "/bin") {
              if (cmdParts.length > 1) {
                const rawBins = cmdParts[1].replace(/\s/g, "");
                const newBins = rawBins.split(",");
                let currentBins = loadBins();
                let addedCount = 0;
                for (let b of newBins) {
                  b = b.trim();
                  if (b && !currentBins.includes(b)) {
                    currentBins.push(b);
                    addedCount++;
                  }
                }
                saveBins(currentBins);
                logEvent("add-bin", { added: newBins });
                await sendMessage(ADMIN_ID, `✅ Added ${addedCount} new BIN(s). Total in database: ${currentBins.length}`);
              } else {
                await sendMessage(ADMIN_ID, "Usage: /bin <comma-separated BINs>");
              }
            }
            else if (command === "/remove") {
              saveBins([]);
              logEvent("remove-all");
              await sendMessage(ADMIN_ID, "All BINs have been removed from the database.");
            }
            else if (command === "/r") {
              if (cmdParts.length > 1) {
                const binToRemove = cmdParts[1].trim();
                let currentBins = loadBins();
                if (currentBins.includes(binToRemove)) {
                  currentBins = currentBins.filter(b => b !== binToRemove);
                  saveBins(currentBins);
                  logEvent("remove-bin", { bin: binToRemove });
                  await sendMessage(ADMIN_ID, `BIN ${binToRemove} removed from the database.`);
                } else {
                  await sendMessage(ADMIN_ID, `BIN ${binToRemove} not found in the database.`);
                }
              } else {
                await sendMessage(ADMIN_ID, "Usage: /r <bin>");
              }
            }
            else if (command === "/info") {
              const stats = loadJSON(STATS_FILE);
              if (!stats || Object.keys(stats).length === 0) {
                await sendMessage(ADMIN_ID, "No stats found yet.");
              } else {
                const allDays = Object.keys(stats).sort();
                const recentDays = allDays.slice(-10);
                const lines = ["📊 <b>Daily Stats (Last 10 Days)</b>"];
                for (const day of recentDays) {
                  const s = stats[day].sent || 0;
                  const e = stats[day].error || 0;
                  lines.push(`• <b>${day}</b> => Sent: ${s}, Errors: ${e}`);
                }
                await sendMessage(ADMIN_ID, lines.join("\n"));
              }
            }
            else if (command === "/logs") {
              const events = loadJSON(EVENTS_FILE);
              if (!events || !events.events || events.events.length === 0) {
                await sendMessage(ADMIN_ID, "No event logs found.");
              } else {
                const lines = ["📝 <b>Event Logs</b>"];
                events.events.forEach((ev, i) => {
                  const etype = ev.type || "unknown";
                  const ts = ev.timestamp || "";
                  const extra = Object.keys(ev).reduce((acc, key) => {
                    if (key !== "type" && key !== "timestamp") {
                      acc[key] = ev[key];
                    }
                    return acc;
                  }, {});
                  lines.push(`<b>${i + 1}.</b> <b>Type:</b> ${etype}, <b>Time:</b> ${ts}, <b>Data:</b> ${JSON.stringify(extra)}`);
                });
                await sendMessage(ADMIN_ID, lines.join("\n"));
              }
            }
          }
        }
      }
    }

    // 3) If running, send a card if enough time passed
    const nowSecs = Date.now() / 1000;
    if (isRunning && (nowSecs - lastSendTime) >= interval) {
      const card = generateCardData();
      if (!card) {
        await sendMessage(ADMIN_ID, "⚠️ No BINs in database. Add some with /bin <list>.");
        await sleep(5000);
        continue;
      }

      const binInfo = await getBinDetails(card.bin);
      const messageText =
        `🔥 AakashScraper v3.1 🔥\n` +
        `━━━━━━━━━━━━━━\n` +
        `<b>Card:</b> <code>${card.card_number}|${card.month}|${card.year}|${card.cvv}</code>\n` +
        `<b>Status:</b> Approved ✅\n` +
        `<b>BIN:</b> #${card.bin}\n` +
        `━━━━━━━━━━━━━━\n` +
        `<b>Info:</b> <code>${binInfo.brand}-${binInfo.type}-${binInfo.level}</code>\n` +
        `<b>Bank:</b> <code>${binInfo.bank}</code>\n` +
        `<b>Country:</b> <code>${binInfo.country_name} [${binInfo.country_flag}]</code>\n` +
        `━━━━━━━━━━━━━━\n` +
        `<b>Extra:</b> <code>${card.card_number.slice(0,12)}xxxx|${card.month}|${card.year}|rnd</code>\n` +
        `<b>Made by:</b> Aakash\n` +
        `━━━━━━━━━━━━━━`;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: "Join", url: "https://t.me/skylegacyy" }]
        ]
      };

      const success = await sendMessage(CHANNEL_ID, messageText, replyMarkup);
      if (success) {
        incrementStats("sent", 1);
        lastSendTime = Date.now() / 1000;
        console.log(`${new Date().toISOString()} - Sent card: ${card.card_number} (BIN: ${card.bin})`);
      } else {
        incrementStats("error", 1);
        console.error("Error sending card message.");
        await sendMessage(ADMIN_ID, "⚠️ Error sending card message. Retrying in 600s...");
        await sleep(ERROR_SLEEP * 1000);
        lastSendTime = Date.now() / 1000;
      }
    }

    // 4) Sleep briefly before looping
    await sleep(1000);
  }
}

main().catch(err => console.error("Fatal error:", err));