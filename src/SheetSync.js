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
  migrateBomSchema_(bom);
  applyBomPresentation_(bom);
  orderUsefulTabs_(ss);

  SpreadsheetApp.getUi().alert(
    'Sheet structure ready.\n\n' +
      'Human: BOM (published videos only)\n' +
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
  var schemaChanged = migrateBomSchema_(bom);

  var pulled = pullChannelVideos_();
  var rows = pulled.rows;

  replaceRawSheet_(raw, rows);
  var viewCounts = writeStatusViews_(ss, rows);
  var appended = appendNewBomRows_(bom, rows);
  var pruned = pruneNonPublishedBomRows_(bom, rows);
  sortBomNewestFirst_(bom);
  var repairResult = repairBomAutoFormulas_(bom, schemaChanged);
  var repaired = repairResult.repaired;
  applyBomPresentation_(bom);
  orderUsefulTabs_(ss);

  applyBomNumberFormats_(bom);

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
    'Subscribers gained filled: ' +
    (pulled.channel.subscribersGainedFilled || 0) +
    '\n' +
    'Extra IDs requested/resolved: ' +
    (pulled.channel.extraRequested || 0) +
    '/' +
    (pulled.channel.extraResolved || 0) +
    '\n' +
    'BOM orphans re-fetched: ' +
    (pulled.channel.bomOrphansRequested || 0) +
    '/' +
    (pulled.channel.bomOrphansResolved || 0) +
    '\n' +
    'Appended ' +
    appended +
    ' published BOM row(s).\n' +
    'Pruned ' +
    pruned +
    ' non-published BOM row(s) with empty human columns.\n' +
    'BOM sorted newest-first by publish/schedule date.\n' +
    'Repaired auto formulas on ' +
    repaired +
    ' BOM row(s).\n' +
    'Human columns stayed with their Video ID rows.';

  if (!(pulled.channel.subscribersGainedFilled > 0) && hasBrandYouTubeAuth_()) {
    msg +=
      '\n\nSubscribers gained is empty: enable YouTube Analytics API, add' +
      '\nyt-analytics.readonly on the OAuth consent screen, then re-run' +
      '\nscripts/get_brand_refresh_token.py and update YOUTUBE_BRAND_REFRESH_TOKEN.';
  }

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

  sheet.getRange(2, 9, rows.length, 1).setNumberFormat('@'); // Duration
  sheet.getRange(2, 10, rows.length, 1).setNumberFormat('@'); // Format
  sheet.getRange(2, 12, rows.length, 1).setNumberFormat('0'); // Subscribers gained
  sheet.getRange(2, 1, rows.length, width).setValues(rows);
  sheet.getRange(2, 5, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  // Feed synced at = last RAW_HEADERS column
  sheet
    .getRange(2, CONFIG.RAW_HEADERS.length, rows.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm');
}

/**
 * Append new **published** BOM rows at the bottom (auto formula columns only).
 * Unlisted / private / scheduled stay on their status tabs, not BOM.
 * Sync then calls sortBomNewestFirst_ so the sheet reads newest-first.
 * Human columns stay blank on new rows.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @param {Array[]} rawRows
 * @return {number}
 */
function appendNewBomRows_(bom, rawRows) {
  var existing = collectBomVideoIds_(bom);
  var toAppend = [];

  for (var i = 0; i < rawRows.length; i++) {
    var videoId = String(rawRows[i][0] || '').trim();
    var status = String(rawRows[i][3] || '').trim().toLowerCase();
    if (!videoId || existing[videoId]) {
      continue;
    }
    if (status !== 'published') {
      continue;
    }
    existing[videoId] = true;
    toAppend.push(videoId);
  }

  if (!toAppend.length) {
    return 0;
  }

  var startRow = bom.getLastRow() + 1;
  if (startRow < 2) startRow = 2;
  var width = CONFIG.BOM_HEADERS.length;
  var values = [];

  for (var j = 0; j < toAppend.length; j++) {
    var rowNum = startRow + j;
    var row = new Array(width);
    for (var c = 0; c < width; c++) {
      row[c] = '';
    }
    row[0] = toAppend[j];
    writeBomAutoFormulasIntoRow_(row, rowNum);
    values.push(row);
  }

  bom.getRange(startRow, 1, toAppend.length, width).setValues(values);
  applyBomNumberFormats_(bom, startRow, toAppend.length);

  applyBomDataValidation_(bom);
  return toAppend.length;
}

/**
 * Duration/Format as text; Subscribers gained as integer; Feed synced as datetime.
 * Inserted columns often inherit a date format, which turns "4" into 1900-01-04.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @param {number=} startRow
 * @param {number=} numRows
 */
function applyBomNumberFormats_(bom, startRow, numRows) {
  if (!bom) return;
  var start = startRow || 2;
  var lastRow = bom.getLastRow();
  if (lastRow < start) return;
  var n = numRows || lastRow - start + 1;
  if (n < 1) return;
  bom.getRange(start, 5, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  bom.getRange(start, 9, n, 1).setNumberFormat('@'); // Duration
  bom.getRange(start, 10, n, 1).setNumberFormat('@'); // Format
  bom.getRange(start, 11, n, 1).setNumberFormat('0'); // Subscribers gained
  bom.getRange(start, 12, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}

/**
 * Insert Format + Subscribers gained columns before Feed synced at when missing.
 * Rewrites the BOM header row to CONFIG.BOM_HEADERS.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @return {boolean} true if columns were inserted (callers should force-repair formulas)
 */
function migrateBomSchema_(bom) {
  if (!bom) return false;
  var lastCol = Math.max(bom.getLastColumn(), 1);
  var headers = bom.getRange(1, 1, 1, lastCol).getValues()[0];
  var names = [];
  for (var i = 0; i < headers.length; i++) {
    names.push(String(headers[i] || '').trim());
  }

  var changed = false;
  if (names.indexOf('Format') === -1) {
    var feedIdx = names.indexOf('Feed synced at');
    var insertAt = feedIdx >= 0 ? feedIdx + 1 : 10;
    bom.insertColumnsBefore(insertAt, 2);
    changed = true;
  } else if (names.indexOf('Subscribers gained') === -1) {
    var formatIdx = names.indexOf('Format');
    bom.insertColumnsAfter(formatIdx + 1, 1);
    changed = true;
  }

  bom.getRange(1, 1, 1, CONFIG.BOM_HEADERS.length).setValues([CONFIG.BOM_HEADERS]);
  bom.getRange(1, 1, 1, CONFIG.BOM_HEADERS.length).setFontWeight('bold');
  bom.setFrozenRows(1);
  applyBomNumberFormats_(bom);
  return changed;
}

/**
 * Remove BOM rows for non-published videos when human columns are empty.
 * Keeps rows that have demo notes / owners / etc.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @param {Array[]} rawRows
 * @return {number}
 */
function pruneNonPublishedBomRows_(bom, rawRows) {
  if (!bom) return 0;
  var statusById = {};
  for (var i = 0; i < rawRows.length; i++) {
    var id = String(rawRows[i][0] || '').trim();
    if (id) {
      statusById[id] = String(rawRows[i][3] || '').trim().toLowerCase();
    }
  }

  var lastRow = bom.getLastRow();
  if (lastRow < 2) return 0;

  var width = Math.max(bom.getLastColumn(), CONFIG.BOM_HEADERS.length);
  var humanStart = CONFIG.BOM_HUMAN_START_COL; // 0-based
  var removed = 0;

  // Bottom-up so deleteRow does not shift unvisited indexes.
  for (var row = lastRow; row >= 2; row--) {
    var videoId = String(bom.getRange(row, 1).getValue() || '').trim();
    if (!videoId) continue;
    var status = statusById[videoId];
    if (!status || status === 'published') continue;

    var humanVals = bom
      .getRange(row, humanStart + 1, 1, width - humanStart)
      .getDisplayValues()[0];
    var hasHuman = false;
    for (var c = 0; c < humanVals.length; c++) {
      if (String(humanVals[c] || '').trim()) {
        hasHuman = true;
        break;
      }
    }
    if (hasHuman) continue;

    bom.deleteRow(row);
    removed++;
  }
  return removed;
}

/**
 * Menu: sort BOM by publish/schedule date, newest first (whole rows).
 */
function sortBomNewestFirst() {
  var bom = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
    CONFIG.SHEETS.BOM
  );
  migrateBomSchema_(bom);
  sortBomNewestFirst_(bom);
  repairBomAutoFormulas_(bom, true);
  try {
    SpreadsheetApp.getUi().alert(
      'BOM sorted newest-first by “Published or scheduled at”.\n' +
        'Whole rows moved together (human columns stayed with their Video ID).'
    );
  } catch (e) {
    Logger.log('BOM sorted newest first');
  }
}

/**
 * Full-row sort so Video ID + formulas + human columns stay aligned.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 */
function sortBomNewestFirst_(bom) {
  if (!bom) return;
  var lastRow = bom.getLastRow();
  if (lastRow < 3) return;

  var lastCol = Math.max(bom.getLastColumn(), CONFIG.BOM_HEADERS.length);
  SpreadsheetApp.flush();
  // Col 5 = Published or scheduled at (XLOOKUP display values).
  bom.getRange(2, 1, lastRow - 1, lastCol).sort({
    column: 5,
    ascending: false
  });
}

/**
 * Fill auto formula columns on a BOM row array. Leaves human cols alone.
 * @param {Array} row
 * @param {number} rowNum
 */
function writeBomAutoFormulasIntoRow_(row, rowNum) {
  var cols = CONFIG.BOM_RAW_LOOKUP_COLS;
  for (var i = 0; i < cols.length; i++) {
    row[i + 1] = bomLookupFormula_(rowNum, cols[i]);
  }
}

/**
 * Menu + sync: restore XLOOKUP formulas on rows that have a Video ID but
 * missing/broken auto columns (common after partial sorts). Never touches
 * human-owned columns (K+).
 * @param {GoogleAppsScript.Spreadsheet.Sheet=} bomOpt
 * @return {number}
 */
function repairBomAutoFormulas(bomOpt) {
  var bom =
    bomOpt ||
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEETS.BOM);
  migrateBomSchema_(bom);
  var result = repairBomAutoFormulas_(bom, true);
  try {
    var msg =
      'Repaired auto formulas on ' +
      result.repaired +
      ' BOM row(s).\nHuman columns were not changed.';
    if (result.missingFromRaw.length) {
      msg +=
        '\n\nStill blank after repair — these Video IDs are not in _youtube_raw:\n' +
        result.missingFromRaw.slice(0, 20).join('\n') +
        (result.missingFromRaw.length > 20
          ? '\n…and ' + (result.missingFromRaw.length - 20) + ' more'
          : '') +
        '\n\nRun YouTube BOM → Sync YouTube to refresh the feed.';
    } else if (result.repaired === 0) {
      msg += '\n\nNo broken auto rows found.';
    }
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log('Repaired ' + result.repaired + ' BOM rows');
  }
  return result.repaired;
}

/**
 * Restore auto formulas when missing, pointed at the wrong row (partial sort
 * with Video ID hidden), Title blank, or force=true (schema migration).
 * Never touches human cols.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} bom
 * @param {boolean=} force
 * @return {{repaired: number, missingFromRaw: string[]}}
 */
function repairBomAutoFormulas_(bom, force) {
  var empty = { repaired: 0, missingFromRaw: [] };
  if (!bom) return empty;
  var lastRow = bom.getLastRow();
  if (lastRow < 2) return empty;

  var numRows = lastRow - 1;
  var ids = bom.getRange(2, 1, numRows, 1).getValues();
  var titleFormulas = bom.getRange(2, 2, numRows, 1).getFormulas();
  var titleValues = bom.getRange(2, 2, numRows, 1).getDisplayValues();
  var formatFormulas = bom.getRange(2, 10, numRows, 1).getFormulas();
  var rawIds = collectRawVideoIds_();
  var repaired = 0;
  var missingFromRaw = [];

  for (var i = 0; i < ids.length; i++) {
    var videoId = String(ids[i][0] || '').trim();
    if (!videoId) continue;

    var rowNum = i + 2;
    var formula = String(titleFormulas[i][0] || '');
    var display = String(titleValues[i][0] || '').trim();
    var formatFormula = String(formatFormulas[i][0] || '');
    var expectedRef = '$A' + rowNum;
    var hasLookup = formula.toUpperCase().indexOf('XLOOKUP') !== -1;
    var pointsAtThisRow = formula.indexOf(expectedRef) !== -1;
    var hasFormatLookup = formatFormula.toUpperCase().indexOf('XLOOKUP') !== -1;
    // Partial sorts (esp. with col A hidden) leave XLOOKUP pointed at another row.
    var needsRepair =
      !!force ||
      !hasLookup ||
      !pointsAtThisRow ||
      !display ||
      !hasFormatLookup;

    if (needsRepair) {
      var auto = new Array(CONFIG.BOM_AUTO_FORMULA_COUNT + 1);
      writeBomAutoFormulasIntoRow_(auto, rowNum);
      var out = [];
      for (var c = 1; c <= CONFIG.BOM_AUTO_FORMULA_COUNT; c++) {
        out.push(auto[c]);
      }
      bom.getRange(rowNum, 2, 1, CONFIG.BOM_AUTO_FORMULA_COUNT).setValues([out]);
      applyBomNumberFormats_(bom, rowNum, 1);
      repaired++;
    }

    if (!rawIds[videoId]) {
      missingFromRaw.push(videoId);
    }
  }

  SpreadsheetApp.flush();
  return { repaired: repaired, missingFromRaw: missingFromRaw };
}

/**
 * @return {Object<string, boolean>}
 */
function collectRawVideoIds_() {
  var map = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName(CONFIG.SHEETS.RAW);
  if (!raw) return map;
  var lastRow = raw.getLastRow();
  if (lastRow < 2) return map;
  var values = raw.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (id) map[id] = true;
  }
  return map;
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
