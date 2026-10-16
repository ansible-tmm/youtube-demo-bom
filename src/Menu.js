/**
 * Spreadsheet UI: custom menu and optional time-driven trigger helpers.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('YouTube BOM')
    .addItem('Sync YouTube', 'syncYouTube')
    .addItem('Ensure sheet structure', 'ensureSheetStructure')
    .addSeparator()
    .addItem('List Brand OAuth channels', 'listBrandYouTubeChannels')
    .addItem('Debug Brand auth property lengths', 'debugBrandAuthPropertyLengths')
    .addItem('Authorize Brand YouTube Account (legacy)', 'authorizeBrandYouTube')
    .addItem('Show Brand OAuth redirect URI', 'showBrandOAuthRedirectUri')
    .addItem('Reset Brand YouTube auth', 'resetBrandYouTubeAuth')
    .addSeparator()
    .addItem('List my YouTube channels (built-in)', 'listMyYouTubeChannels')
    .addItem('Add scheduled video IDs…', 'promptAddExtraVideoIds')
    .addItem('Suggest demo slugs (from DemoMap)', 'suggestDemoSlugs')
    .addSeparator()
    .addItem('Install daily sync trigger (7am)', 'installDailyTrigger')
    .addItem('Remove sync triggers', 'removeSyncTriggers')
    .addToUi();
}

/**
 * Time-driven trigger: sync once per day around 7:00 (script timezone).
 * Prefer YOUTUBE_BRAND_REFRESH_TOKEN so scheduled/private stay visible.
 */
function installDailyTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger('syncYouTube')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
  SpreadsheetApp.getUi().alert(
    'Daily sync trigger installed (~7:00 in the script timezone).\n\n' +
      'Timezone: check appsscript.json (America/New_York).\n' +
      'Uses Brand refresh token when configured.\n' +
      'Use "Remove sync triggers" to disable.'
  );
}

/** @deprecated Use installDailyTrigger */
function installHourlyTrigger() {
  installDailyTrigger();
}

/**
 * Delete all project triggers that call syncYouTube.
 */
function removeSyncTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncYouTube') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
