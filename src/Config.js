/**
 * Sheet names and column contracts.
 *
 * Pattern A (preferred):
 *   _youtube_raw  — machine-owned; full replace every sync
 *   Scheduled / Unlisted / Private — machine-owned status views (newest first)
 *   BOM           — human sheet; sync appends published Video ID rows only
 *   Auto stats on BOM come from XLOOKUP formulas into _youtube_raw
 */

var CONFIG = {
  SHEETS: {
    CONFIG: '_config',
    RAW: '_youtube_raw',
    BOM: 'BOM',
    SCHEDULED: 'Scheduled',
    UNLISTED: 'Unlisted',
    PRIVATE: 'Private',
    /** Paste scheduled/private video IDs or Studio URLs here (Brand Account workaround). */
    EXTRA_IDS: '_extra_video_ids'
  },

  /** Machine status views: full replace each sync, sorted newest date first. */
  STATUS_VIEWS: [
    { sheet: 'Scheduled', status: 'scheduled' },
    { sheet: 'Unlisted', status: 'unlisted' },
    { sheet: 'Private', status: 'private' }
  ],

  EXTRA_ID_HEADERS: ['video_id_or_url', 'notes'],

  /** Default channel when _config is empty. Override in the _config tab. */
  DEFAULT_CHANNEL_HANDLE: 'ansibleautomation',

  /** The Ansible Playbook — set in _config for reliable sync (Brand Account). */
  DEFAULT_CHANNEL_ID: 'UCPJo5UY1KsP7J1BuHmiWNzQ',

  /**
   * _youtube_raw columns (0-based). Full replace every sync.
   * Header row must match RAW_HEADERS exactly.
   */
  RAW_HEADERS: [
    'Video ID',
    'Title',
    'URL',
    'Status',
    'Published or scheduled at',
    'Views',
    'Likes',
    'Comments',
    'Duration',
    'Format',
    'Privacy',
    'Subscribers gained',
    'Feed synced at'
  ],

  /**
   * BOM columns. Index 0 = Video ID (append-only key).
   * Indices 1–11 = auto via formulas (written when appending / repairing).
   * Indices 12+ = human-owned; never written by sync.
   */
  BOM_HEADERS: [
    'Video ID',
    'Title',
    'URL',
    'Status',
    'Published or scheduled at',
    'Views',
    'Likes',
    'Comments',
    'Duration',
    'Format',
    'Subscribers gained',
    'Feed synced at',
    'Demo slug',
    'Script / runbook URL',
    'Repo path',
    'Owner',
    'Review status',
    'Reviewed by',
    'Reviewed on',
    'Priority',
    'Notes'
  ],

  /** First human-owned column index on BOM (Demo slug). */
  BOM_HUMAN_START_COL: 12,

  /** Number of auto formula columns after Video ID (Title … Feed synced at). */
  BOM_AUTO_FORMULA_COUNT: 11,

  /**
   * 1-based raw column indexes for BOM XLOOKUP targets (matches RAW_HEADERS).
   * Privacy is raw-only (not shown on BOM).
   */
  BOM_RAW_LOOKUP_COLS: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13],

  REVIEW_STATUS_VALUES: ['Not started', 'In review', 'Approved']
};

/**
 * Read channel settings from the _config sheet.
 * Expected keys in column A, values in column B:
 *   channel_handle | channel_id | auth_mode | include_scheduled
 *
 * auth_mode:
 *   auto   — prefer Channels.list(mine) when it matches handle/id (sees scheduled)
 *   mine   — always use the authenticated user's matching managed channel
 *   public — always resolve via handle/id (public videos only)
 */
function getSyncConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CONFIG);
  var out = {
    channelHandle: CONFIG.DEFAULT_CHANNEL_HANDLE,
    channelId: CONFIG.DEFAULT_CHANNEL_ID,
    authMode: 'auto',
    includeScheduled: true
  };

  if (!sheet) {
    return out;
  }

  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim().toLowerCase();
    var val = String(values[i][1] || '').trim();
    if (!key) continue;
    if (key === 'channel_handle' || key === 'handle') {
      out.channelHandle = val.replace(/^@/, '');
    } else if (key === 'channel_id' || key === 'id') {
      out.channelId = val;
    } else if (key === 'auth_mode' || key === 'auth') {
      out.authMode = val.toLowerCase() || 'auto';
    } else if (key === 'include_scheduled') {
      out.includeScheduled = /^(1|true|yes|y)$/i.test(val);
    }
  }

  return out;
}
