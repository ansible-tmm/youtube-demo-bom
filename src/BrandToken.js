/**
 * Brand YouTube access via a refresh token obtained outside Apps Script
 * (scripts/get_brand_refresh_token.py). Avoids the broken /usercallback
 * path when authorizing as a Brand Account.
 *
 * Script properties:
 *   YOUTUBE_OAUTH_CLIENT_ID
 *   YOUTUBE_OAUTH_CLIENT_SECRET
 *   YOUTUBE_BRAND_REFRESH_TOKEN
 */

var BRAND_TOKEN_CACHE_KEY = 'brand_yt_access_token';

/**
 * Prefer refresh-token auth; fall back to OAuth2 library service.
 * @return {boolean}
 */
function hasBrandYouTubeAuth_() {
  var props = PropertiesService.getScriptProperties();
  if (prop_(props, 'YOUTUBE_BRAND_REFRESH_TOKEN')) {
    return true;
  }
  try {
    return getBrandYouTubeService_().hasAccess();
  } catch (e) {
    return false;
  }
}

/**
 * @param {GoogleAppsScript.Properties.Properties} props
 * @param {string} key
 * @return {string}
 */
function prop_(props, key) {
  return String(props.getProperty(key) || '').trim();
}

/**
 * Menu: show lengths only (no secrets) to catch truncated Script properties.
 * Expected approx: client_id=72, client_secret=35, refresh_token=103
 */
function debugBrandAuthPropertyLengths() {
  var props = PropertiesService.getScriptProperties();
  var clientId = prop_(props, 'YOUTUBE_OAUTH_CLIENT_ID');
  var clientSecret = prop_(props, 'YOUTUBE_OAUTH_CLIENT_SECRET');
  var refresh = prop_(props, 'YOUTUBE_BRAND_REFRESH_TOKEN');
  uiAlert_(
    'Script property lengths (after trim):\n\n' +
      'YOUTUBE_OAUTH_CLIENT_ID: ' +
      clientId.length +
      ' (expect ~72, ends with .apps.googleusercontent.com: ' +
      /\.apps\.googleusercontent\.com$/.test(clientId) +
      ')\n' +
      'YOUTUBE_OAUTH_CLIENT_SECRET: ' +
      clientSecret.length +
      ' (expect ~35, starts with GOCSPX-: ' +
      /^GOCSPX-/.test(clientSecret) +
      ')\n' +
      'YOUTUBE_BRAND_REFRESH_TOKEN: ' +
      refresh.length +
      ' (expect ~103, starts with 1//: ' +
      /^1\/\//.test(refresh) +
      ')\n\n' +
      'If any length is far short, re-paste the full value.'
  );
}

/**
 * @return {string} Bearer access token
 */
function getBrandAccessToken_() {
  var props = PropertiesService.getScriptProperties();
  var refresh = prop_(props, 'YOUTUBE_BRAND_REFRESH_TOKEN');

  if (refresh) {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(BRAND_TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }

    var clientId = prop_(props, 'YOUTUBE_OAUTH_CLIENT_ID');
    var clientSecret = prop_(props, 'YOUTUBE_OAUTH_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error(
        'YOUTUBE_BRAND_REFRESH_TOKEN is set but client id/secret are missing.'
      );
    }

    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: 'refresh_token'
      },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var body = JSON.parse(resp.getContentText());
    if (code < 200 || code >= 300 || !body.access_token) {
      throw new Error(
        'Failed to refresh Brand YouTube token (HTTP ' +
          code +
          '):\n' +
          resp.getContentText() +
          '\n\nRe-run scripts/get_brand_refresh_token.py and update ' +
          'YOUTUBE_BRAND_REFRESH_TOKEN.'
      );
    }

    var ttl = Math.max(60, Number(body.expires_in || 3600) - 120);
    cache.put(BRAND_TOKEN_CACHE_KEY, body.access_token, ttl);
    return body.access_token;
  }

  var service = getBrandYouTubeService_();
  if (!service.hasAccess()) {
    throw new Error(
      'Brand YouTube is not authorized.\n' +
        'Preferred: run scripts/get_brand_refresh_token.py and set ' +
        'YOUTUBE_BRAND_REFRESH_TOKEN in Script properties.\n' +
        'See docs/BRAND_OAUTH_SETUP.md'
    );
  }
  return service.getAccessToken();
}

/**
 * Menu: confirm refresh-token auth and list mine=true channels.
 */
function listBrandYouTubeChannels() {
  if (!hasBrandYouTubeAuth_()) {
    uiAlert_(
      'Brand YouTube is not configured yet.\n\n' +
        '1. python3 scripts/get_brand_refresh_token.py\n' +
        '2. Paste refresh token into Script property YOUTUBE_BRAND_REFRESH_TOKEN\n' +
        '3. Ensure CLIENT_ID / CLIENT_SECRET match the Desktop OAuth client\n\n' +
        'See docs/BRAND_OAUTH_SETUP.md'
    );
    return;
  }
  uiAlert_(summarizeBrandTokenChannels_());
}
