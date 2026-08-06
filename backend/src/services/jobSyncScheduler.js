'use strict';

const cron = require('node-cron');
const { syncJobs } = require('./jobSyncService');
const logger = require('../config/logger');

// Mutex lock to avoid overlapping scheduler execution
let isSyncing = false;

// Varied keywords + pages so results aren't dominated by whichever
// employer happens to have the largest bulk-posting campaign that day.
const SEARCH_KEYWORDS = ['developer', 'software engineer', 'frontend developer', 'backend developer', 'full stack developer'];
const PAGES_PER_KEYWORD = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the sync pipeline across multiple keywords/pages and logs aggregate metrics.
 */
const runScheduledSync = async () => {
  if (isSyncing) {
    logger.warn('🔄 Job Sync Scheduler: Previous sync is still running. Skipping...');
    return;
  }

  isSyncing = true;
  logger.info('📋 Cron started: Adzuna Job Sync');

  const totals = { fetched: 0, updated: 0, inserted: 0 };

  try {
    for (const keyword of SEARCH_KEYWORDS) {
      for (let page = 1; page <= PAGES_PER_KEYWORD; page += 1) {
        try {
          const result = await syncJobs(keyword, '', page);
          totals.fetched += (result.upsertedCount || 0) + (result.matchedCount || 0);
          totals.updated += result.modifiedCount || 0;
          totals.inserted += result.upsertedCount || 0;
        } catch (error) {
          logger.error(`❌ Job Sync Scheduler Error (keyword: "${keyword}", page: ${page}): ${error.message}`);
        }

        // Small delay between calls to stay well within Adzuna's rate limits.
        await sleep(300);
      }
    }

    logger.info(`📋 Jobs Fetched: ${totals.fetched}`);
    logger.info(`📋 Jobs Updated: ${totals.updated}`);
    logger.info(`📋 Jobs Inserted: ${totals.inserted}`);
    logger.info('📋 Sync Completed');
  } finally {
    isSyncing = false;
  }
};

/**
 * Starts the Node-Cron cron-scheduler daemon.
 */
const initSyncScheduler = () => {
  logger.info('⚙️ Initializing Adzuna Job Sync Cron Daemon...');

  // 1. Run once shortly after startup (15 seconds delay)
  setTimeout(() => {
    logger.info('⏰ Triggering initial startup Adzuna sync run...');
    runScheduledSync();
  }, 15 * 1000);

  // 2. Schedule cron to execute every 3 hours (at minute 0 of every 3rd hour)
  cron.schedule('0 */3 * * *', () => {
    logger.info('⏰ Cron triggered: Starting Adzuna Job Sync schedule...');
    runScheduledSync();
  });

  logger.info('✅ Adzuna Job Sync Cron Daemon successfully scheduled: [0 */3 * * *]');
};

module.exports = { initSyncScheduler, runScheduledSync };
