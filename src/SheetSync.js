/**
 * Pattern A sync:
 * 1. Full-replace _youtube_raw from the YouTube API.
 * 2. Append new Video ID rows to BOM (auto formula columns only).
 * 3. Never touch human columns or rows with a blank Video ID.
 */

/**
 * Ensure required sheets and header rows exist.
 * Safe to run repeatedly; does not wipe human BOM data.
 */
function ensureSheetStructure() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureConfigSheet_(ss);
  var raw = ensureHeaderSheet_(ss, CONFIG.SHEETS.RAW, CONFIG.RAW_HEADERS);
  var bom = ensureHeaderSheet_(ss, CONFIG.SHEETS.BOM, CONFIG.BOM_HEADERS);
  ensureHeaderSheet_(ss, CONFIG.SHEETS.EXTRA_IDS, CONFIG.EXTRA_ID_HEADERS);
  ensureStatusViewSheets_(ss);
  migrateLegacyHeaders_(raw, bom);
  applyBomPresentation_(bom);
  orderUsefulTabs_(ss);

  SpreadsheetApp.getUi().alert(
    'Sheet structure ready.\n\n' +
      'Human: BOM\n' +
      'Machine views (newest first): Scheduled, Unlisted, Private, _youtube_raw\n' +
      'Video ID is hidden on BOM (unhide via column menu).'
  );
}

function ensureConfigSheet_(ss) {
  var name = CONFIG.SHEETS.CONFIG;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 5, 2).setValues([
      ['key', 'value'],
      ['channel_handle', CONFIG.DEFAULT_CHANNEL_HANDLE],
      ['channel_id', CONFIG.DEFAULT_CHANNEL_ID],
      ['auth_mode', 'auto'],
      ['include_scheduled', 'true']
    ]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 280);
    return sheet;
  }

  // Ensure auth_mode row exists on older sheets.
  var values = sheet.getDataRange().getValues();
  var hasAuth = false;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === 'auth_mode') {
      hasAuth = true;
      break;
    }
  }
  if (!hasAuth) {
    sheet.appendRow(['auth_mode', 'auto']);
  }
  return sheet;
}

function ensureHeaderSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsHeader = existing.every(function (c) {
    return String(c).trim() === '';
  });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Rename legacy "Last synced at" header → "Feed synced at" if present.
 */
function migrateLegacyHeaders_(raw, bom) {
  renameHeaderCell_(raw, 'Last synced at', 'Feed synced at');
  renameHeaderCell_(bom, 'Last synced at', 'Feed synced at');
}

function renameHeaderCell_(sheet, fromLabel, toLabel) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === fromLabel) {
      sheet.getRange(1, i + 1).setValue(toLabel);
    }
  }
}

function applyBomPresentation_(bom) {
  if (!bom) return;
  applyBomDataValidation_(bom);
  // Stable key stays in col A for formulas; hide from humans.
  try {
    bom.hideColumns(1);
  } catch (e) {
    // ignore if already hidden / permission edge
  }
}

function applyBomDataValidation_(bom) {
  if (!bom) return;
  // Review status: 0-based human start 10 + offset 4 → col index 14 → 1-based 15
  var reviewCol = CONFIG.BOM_HUMAN_START_COL + 4 + 1;
  var numRows = Math.max(bom.getMaxRows() - 1, 500);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.REVIEW_STATUS_VALUES, true)
    .setAllowInvalid(true)
    .build();
  bom.getRange(2, reviewCol, numRows, 1).setDataValidation(rule);
}

/**
 * Main sync entry point (menu + triggers).
 */
function syncYouTube() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureConfigSheet_(ss);
  var raw = ensureHeaderSheet_(ss, CONFIG.SHEETS.RAW, CONFIG.RAW_HEADERS);
  var bom = ensureHeaderSheet_(ss, CONFIG.SHEETS.BOM, CONFIG.BOM_HEADERS);
  ensureHeaderSheet_(ss, CONFIG.SHEETS.EXTRA_IDS, CONFIG.EXTRA_ID_HEADERS);
  ensureStatusViewSheets_(ss);
  migrateLegacyHeaders_(raw, bom);

  var pulled = pullChannelVideos_();
  var rows = pulled.rows;

  replaceRawSheet_(raw, rows);
  var viewCounts = writeStatusViews_(ss, rows);
  var appended = appendNewBomRows_(bom, rows);
  applyBomPresentation_(bom);
  orderUsefulTabs_(ss);

  // Fix duration display on existing BOM formula rows (plain text).
  var bomLast = bom.getLastRow();
  if (bomLast >= 2) {
    bom.getRange(2, 9, bomLast - 1, 1).setNumberFormat('@');
  }

  var msg =
    'Synced ' +
    rows.length +
    ' videos from "' +
    pulled.channel.title +
    '".\n' +
    'Auth path: ' +
    pulled.channel.authPath +
    '\n' +
    'Statuses: ' +
    summarizeStatuses_(rows) +
    '\n' +
    'Views: Scheduled=' +
    viewCounts.scheduled +
    ', Unlisted=' +
    viewCounts.unlisted +
    ', Private=' +
    viewCounts.private +
    ' (newest first)\n' +
    'Extra IDs requested/resolved: ' +
    (pulled.channel.extraRequested || 0) +
    '/' +
    (pulled.channel.extraResolved || 0) +
    '\n' +
    'Appended ' +
    appended +
    ' new BOM row(s).\n' +
    'Human columns and blank-Video-ID rows were left untouched.';

  if (String(pulled.channel.authPath).indexOf('brand-oauth') === 0) {
    // ok
  } else if (String(pulled.channel.authPath).indexOf('public') === 0) {
    msg +=
      '\n\nStill on public path. For scheduled videos:' +
      '\nYouTube BOM → Authorize Brand YouTube Account' +
      '\n(pick The Ansible Playbook in the browser), then Sync again.' +
      '\nSee docs/BRAND_OAUTH_SETUP.md';
  }

  if (
    (pulled.channel.extraRequested || 0) > 0 &&
    (pulled.channel.extraResolved || 0) < (pulled.channel.extraRequested || 0)
  ) {
    msg +=
      '\n\nSome _extra_video_ids did not resolve. Confirm the ID is correct' +
      '\nand that this Google account can open that video in Studio.';
  }

  try {
    SpreadsheetApp.getUi().alert(
      'YouTube sync complete',
      msg,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    Logger.log(msg);
  }
}

/**
 * Ensure Scheduled / Unlisted / Private tabs exist with raw headers.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function ensureStatusViewSheets_(ss) {
  for (var i = 0; i < CONFIG.STATUS_VIEWS.length; i++) {
    ensureHeaderSheet_(ss, CONFIG.STATUS_VIEWS[i].sheet, CONFIG.RAW_HEADERS);
  }
}

/**
 * Put human + status views in a predictable tab order (status tabs near the end).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 */
function orderUsefulTabs_(ss) {
  var order = [
    CONFIG.SHEETS.BOM,
    CONFIG.SHEETS.SCHEDULED,
    CONFIG.SHEETS.UNLISTED,
    CONFIG.SHEETS.PRIVATE,
    CONFIG.SHEETS.RAW,
    CONFIG.SHEETS.CONFIG,
    CONFIG.SHEETS.EXTRA_IDS
  ];
  for (var i = 0; i < order.length; i++) {
    var sh = ss.getSheetByName(order[i]);
    if (sh) {
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(i + 1);
    }
  }
}

/**
 * Full-replace status view tabs (machine-owned). Rows already newest-first.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Array[]} rows
 * @return {{scheduled: number, unlisted: number, private: number}}
 */
function writeStatusViews_(ss, rows) {
  var counts = { scheduled: 0, unlisted: 0, private: 0 };
  for (var i = 0; i < CONFIG.STATUS_VIEWS.length; i++) {
    var view = CONFIG.STATUS_VIEWS[i];
    var sheet = ensureHeaderSheet_(ss, view.sheet, CONFIG.RAW_HEADERS);
    var filtered = [];
    for (var r = 0; r < rows.length; r++) {
      if (String(rows[r][3] || '').toLowerCase() === view.status) {
        filtered.push(rows[r]);
      }
    }
    counts[view.status] = filtered.length;
    replaceMachineSheet_(sheet, filtered);
  }
  return counts;
}

/**
 * Full replace of _youtube_raw data (keeps header). Newest first.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} raw
 * @param {Array[]} rows
 */
function replaceRawSheet_(raw, rows) {
  replaceMachineSheet_(raw, rows);
}

/**
 * Clear data rows and write values; format date + duration columns.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array[]} rows
 */
function replaceMachineSheet_(sheet, rows) {
  var width = CONFIG.RAW_HEADERS.length;
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, width).clearContent();
  }

  // Always rewrite header (keeps contract obvious on status tabs).
  sheet.getRange(1, 1, 1, width).setValues([CONFIG.RAW_HEADERS]);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  sheet.setFrozenRows(1);

  if (!rows.length) {
    return;
  }

  sheet.getRange(2, 9, rows.length, 1).setNumberFormat('@');
  sheet.getRange(2, 1, rows.length, width).setValues(rows);
  sheet.getRange(2, 5, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(2, 11, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}

/**
 * Append BOM rows for video IDs not already present.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @param {Array[]} rawRows
 * @return {number}
 */
function appendNewBomRows_(bom, rawRows) {
  var existing = collectBomVideoIds_(bom);
  var toAppend = [];

  for (var i = 0; i < rawRows.length; i++) {
    var videoId = String(rawRows[i][0] || '').trim();
    if (!videoId || existing[videoId]) {
      continue;
    }
    existing[videoId] = true;
    toAppend.push(videoId);
  }

  if (!toAppend.length) {
    return 0;
  }

  var startRow = Math.max(bom.getLastRow() + 1, 2);
  var width = CONFIG.BOM_HEADERS.length;
  var values = [];

  for (var j = 0; j < toAppend.length; j++) {
    var rowNum = startRow + j;
    var row = new Array(width);
    for (var c = 0; c < width; c++) {
      row[c] = '';
    }
    row[0] = toAppend[j];
    row[1] = bomLookupFormula_(rowNum, 2);
    row[2] = bomLookupFormula_(rowNum, 3);
    row[3] = bomLookupFormula_(rowNum, 4);
    row[4] = bomLookupFormula_(rowNum, 5);
    row[5] = bomLookupFormula_(rowNum, 6);
    row[6] = bomLookupFormula_(rowNum, 7);
    row[7] = bomLookupFormula_(rowNum, 8);
    row[8] = bomLookupFormula_(rowNum, 9);
    row[9] = bomLookupFormula_(rowNum, 11);
    values.push(row);
  }

  bom.getRange(startRow, 1, toAppend.length, width).setValues(values);
  bom.getRange(startRow, 5, toAppend.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  bom.getRange(startRow, 9, toAppend.length, 1).setNumberFormat('@');
  bom.getRange(startRow, 10, toAppend.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  applyBomDataValidation_(bom);
  return toAppend.length;
}

/**
 * @param {number} rowNum
 * @param {number} rawColIndex 1-based
 * @return {string}
 */
function bomLookupFormula_(rowNum, rawColIndex) {
  var raw = CONFIG.SHEETS.RAW;
  var colLetter = columnToLetter_(rawColIndex);
  return (
    '=IF($A' +
    rowNum +
    '="","",IFERROR(XLOOKUP($A' +
    rowNum +
    ",'" +
    raw +
    "'!$A:$A,'" +
    raw +
    "'!$" +
    colLetter +
    ':$' +
    colLetter +
    '),""))'
  );
}

function columnToLetter_(col) {
  var temp = '';
  var n = col;
  while (n > 0) {
    var rem = (n - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    n = Math.floor((n - 1) / 26);
  }
  return temp;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @return {Object<string, boolean>}
 */
function collectBomVideoIds_(bom) {
  var map = {};
  var lastRow = bom.getLastRow();
  if (lastRow < 2) return map;

  var ids = bom.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '').trim();
    if (id) {
      map[id] = true;
    }
  }
  return map;
}
