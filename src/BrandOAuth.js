/**
 * Method 3: OAuth2 for Brand Account YouTube access.
 *
 * Apps Script's built-in "Allow" cannot pick a Brand Account identity.
 * This uses the OAuth2 library + a Cloud OAuth client so the browser
 * account chooser can include "The Ansible Playbook".
 *
 * Setup: see docs/BRAND_OAUTH_SETUP.md
 *
 * OAuth2 is vendored in this project (OAuth2.js + OAuth2Service.js +
 * OAuth2Storage.js + OAuth2Utilities.js) because some orgs block Libraries.
 *
 * Script properties (Project Settings → Script properties):
 *   YOUTUBE_OAUTH_CLIENT_ID
 *   YOUTUBE_OAUTH_CLIENT_SECRET
 */

var BRAND_OAUTH_SERVICE_NAME = 'youtube-brand';
var BRAND_OAUTH_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

/**
 * @return {GoogleAppsScriptOAuth2.OAuth2Service}
 */
function getBrandYouTubeService_() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('YOUTUBE_OAUTH_CLIENT_ID');
  var clientSecret = props.getProperty('YOUTUBE_OAUTH_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET.\n' +
        'Set them under Apps Script → Project Settings → Script properties.\n' +
        'See docs/BRAND_OAUTH_SETUP.md'
    );
  }

  return OAuth2.createService(BRAND_OAUTH_SERVICE_NAME)
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(clientId)
    .setClientSecret(clientSecret)
    .setCallbackFunction('brandAuthCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setCache(CacheService.getUserCache())
    .setLock(LockService.getUserLock())
    .setScope(BRAND_OAUTH_SCOPE)
    .setParam('access_type', 'offline')
    // select_account: show chooser (pick Brand Account / Playbook)
    // consent: force refresh token issuance
    .setParam('prompt', 'select_account consent');
}

/** True when a brand (or user) YouTube token is stored and usable. */
function hasBrandYouTubeAuth_() {
  try {
    return getBrandYouTubeService_().hasAccess();
  } catch (e) {
    return false;
  }
}

/**
 * Menu: show redirect URIs that must be registered on the OAuth client.
 * Workspace callbacks often use /a/macros/<domain>/d/... as well as /macros/d/...
 */
function showBrandOAuthRedirectUri() {
  var scriptId = ScriptApp.getScriptId();
  var uriStandard = getRedirectUri(scriptId);
  var uriWorkspace =
    'https://script.google.com/a/macros/redhat.com/d/' +
    scriptId +
    '/usercallback';
  SpreadsheetApp.getUi().alert(
    'Add BOTH of these under Cloud Console → Credentials →\n' +
      'your OAuth client → Authorized redirect URIs:\n\n' +
      '1) ' +
      uriStandard +
      '\n\n2) ' +
      uriWorkspace +
      '\n\nScript ID:\n' +
      scriptId +
      '\n\nBefore Brand Authorize: in Apps Script editor, select\n' +
      'authorizeBrandYouTube → Run → Allow (authorizes the script itself).\n' +
      'Then Authorize Brand YouTube Account from the Sheet.'
  );
}

/**
 * Editor-safe: grants script scopes + logs the Brand auth URL (no Sheet UI).
 * Run this from Apps Script if you only need to click through "Allow".
 */
function prepareBrandYouTubeAuth() {
  var service = getBrandYouTubeService_();
  if (service.hasAccess()) {
    Logger.log('Brand YouTube already authorized.');
    return 'already authorized';
  }
  var url = service.getAuthorizationUrl();
  Logger.log('Open this URL to authorize Brand YouTube:\n' + url);
  return url;
}

/**
 * Menu: open browser auth so you can pick The Ansible Playbook brand.
 * Run from the Sheet menu (not the Apps Script editor) so UI dialogs work.
 */
function authorizeBrandYouTube() {
  var service = getBrandYouTubeService_();

  if (service.hasAccess()) {
    uiAlert_(
      'Brand YouTube already authorized.\n\n' +
        summarizeBrandTokenChannels_() +
        '\n\nTo re-pick the brand: YouTube BOM → Reset Brand YouTube auth, then Authorize again.'
    );
    return;
  }

  var url = service.getAuthorizationUrl();
  try {
    var html = HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;padding:12px;line-height:1.5">' +
        '<p><b>Authorize Brand Account</b></p>' +
        '<p>1. Click the link below (opens a new tab).</p>' +
        '<p>2. Sign in with your <b>redhat.com</b> account.</p>' +
        '<p>3. If Google shows multiple accounts/channels, choose ' +
        '<b>The Ansible Playbook</b> (Brand Account) — not only your personal channel.</p>' +
        '<p>4. Click Allow, then return here and run <b>Sync YouTube</b>.</p>' +
        '<p style="margin-top:16px"><a href="' +
        url +
        '" target="_blank" style="font-size:14px">Authorize YouTube (Brand Account)</a></p>' +
        '<p style="font-size:11px;word-break:break-all;color:#555">' +
        url +
        '</p>' +
        '</div>'
    )
      .setWidth(520)
      .setHeight(320);
    SpreadsheetApp.getUi().showModalDialog(html, 'YouTube Brand OAuth');
  } catch (e) {
    // Editor / missing UI scope: log URL instead of hanging.
    Logger.log('Brand auth URL:\n' + url);
    uiAlert_(
      'Open this URL in a new tab to authorize the Brand Account:\n\n' +
        url +
        '\n\nAfter Allow, return here → List Brand OAuth channels.\n\n' +
        '(If this alert did not appear, open Executions → view log for the URL.)'
    );
  }
}

/** @param {string} message */
function uiAlert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}

/**
 * OAuth2 library callback (must stay named to match setCallbackFunction).
 * @param {Object} request
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function brandAuthCallback(request) {
  var service = getBrandYouTubeService_();
  var ok = service.handleCallback(request);
  var body = ok
    ? '<p>Authorization successful. You can close this tab and return to the Sheet.</p>' +
      '<p>Next: YouTube BOM → Sync YouTube (look for Auth path: brand-oauth).</p>'
    : '<p>Authorization denied. Close this tab and try again.</p>';
  return HtmlService.createHtmlOutput(body);
}

/** Menu: clear stored brand token. */
function resetBrandYouTubeAuth() {
  try {
    getBrandYouTubeService_().reset();
  } catch (e) {
    // still ok
  }
  SpreadsheetApp.getUi().alert(
    'Brand YouTube auth cleared.\n\nRun Authorize Brand YouTube Account again.'
  );
}

/**
 * Menu: show channels visible to the brand OAuth token (mine=true).
 */
function listBrandYouTubeChannels() {
  if (!hasBrandYouTubeAuth_()) {
    SpreadsheetApp.getUi().alert(
      'Brand YouTube is not authorized yet.\n\n' +
        'Run YouTube BOM → Authorize Brand YouTube Account first.'
    );
    return;
  }
  SpreadsheetApp.getUi().alert(summarizeBrandTokenChannels_());
}

/**
 * @return {string}
 */
function summarizeBrandTokenChannels_() {
  var data = youtubeHttpGet_('channels', {
    part: 'snippet,contentDetails',
    mine: 'true',
    maxResults: '50'
  });
  var items = data.items || [];
  if (!items.length) {
    return (
      'Brand token has access, but mine=true returned no channels.\n' +
      'Reset auth and pick The Ansible Playbook in the account chooser.'
    );
  }
  var lines = ['Channels visible to Brand OAuth token (mine=true):', ''];
  for (var i = 0; i < items.length; i++) {
    var sn = items[i].snippet || {};
    lines.push(
      (sn.title || '') +
        ' | @' +
        (sn.customUrl || '(no handle)') +
        ' | ' +
        items[i].id
    );
  }
  return lines.join('\n');
}
